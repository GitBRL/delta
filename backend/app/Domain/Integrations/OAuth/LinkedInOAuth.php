<?php

declare(strict_types=1);

namespace App\Domain\Integrations\OAuth;

use App\Domain\Integrations\DiscoveredAccount;
use App\Domain\Integrations\OAuth\Apps\AppCredentials;
use App\Domain\Integrations\OAuth\Apps\AppVendor;
use App\Domain\Integrations\OAuth\Apps\AppVerification;
use App\Domain\Integrations\OAuth\Apps\PlatformApps;
use App\Domain\Integrations\OAuth\Apps\VerifiesApp;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Login do LinkedIn (Marketing API, escopos r_ads e r_ads_reporting). Token de ~60 dias com
 * refresh token (quando o app tem o recurso), renovado pelo AccessTokens. ADR 0024.
 */
final readonly class LinkedInOAuth implements OAuthProvider, VerifiesApp
{
    public const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';

    private const SCOPES = ['r_ads', 'r_ads_reporting'];

    public function __construct(private PlatformApps $apps) {}

    public function isConfigured(string $platform): bool
    {
        return $platform === 'linkedin_ads' && $this->apps->credentials(AppVendor::Linkedin) !== null;
    }

    public function usesPkce(): bool
    {
        return false;
    }

    public function authorizationUrl(string $platform, string $state, string $redirectUri, ?string $codeChallenge): string
    {
        return 'https://www.linkedin.com/oauth/v2/authorization?'.http_build_query([
            'response_type' => 'code', 'client_id' => $this->app()->clientId, 'redirect_uri' => $redirectUri, 'state' => $state, 'scope' => implode(' ', self::SCOPES),
        ]);
    }

    public function exchange(string $platform, string $code, string $redirectUri, ?string $codeVerifier): OAuthTokens
    {
        $app = $this->app();
        $response = $this->call(fn () => Http::asForm()->timeout(15)->acceptJson()->post(self::TOKEN_URL, [
            'grant_type' => 'authorization_code', 'code' => $code, 'client_id' => $app->clientId, 'client_secret' => $app->clientSecret, 'redirect_uri' => $redirectUri,
        ]), 'a autorização');

        $token = $response->json('access_token');
        if (! is_string($token) || $token === '') {
            throw OAuthException::platform('a autorização');
        }
        $refresh = $response->json('refresh_token');

        return OAuthTokens::expiringIn($token, $response->json('expires_in'), is_string($refresh) ? $refresh : null, self::SCOPES);
    }

    public function discoverAccounts(string $platform, OAuthTokens $tokens): array
    {
        $users = $this->call(fn () => self::rest($tokens->accessToken)->get('https://api.linkedin.com/rest/adAccountUsers', ['q' => 'authenticatedUser']), 'a listagem de contas de anúncio');

        $accounts = [];
        foreach ((array) $users->json('elements') as $element) {
            $urn = data_get($element, 'account');
            if (! is_string($urn) || preg_match('/(\d+)$/', $urn, $m) !== 1) {
                continue;
            }
            $detail = self::rest($tokens->accessToken)->get("https://api.linkedin.com/rest/adAccounts/{$m[1]}");
            $name = $detail->successful() ? $detail->json('name') : null;
            $currency = $detail->successful() ? $detail->json('currency') : null;
            $accounts[] = new DiscoveredAccount($m[1], is_string($name) ? $name : "LinkedIn Ads {$m[1]}", 'ad_account', is_string($currency) ? $currency : null);
        }

        return $accounts;
    }

    /** Código propositalmente inválido: credenciais certas → erro do código; erradas → invalid_client. */
    public function verifyApp(AppCredentials $app): AppVerification
    {
        try {
            $response = Http::asForm()->timeout(10)->acceptJson()->post(self::TOKEN_URL, [
                'grant_type' => 'authorization_code', 'code' => 'delta-verificacao', 'client_id' => $app->clientId, 'client_secret' => $app->clientSecret,
                'redirect_uri' => OAuthFlow::redirectUri('linkedin_ads'),
            ]);
        } catch (ConnectionException) {
            return AppVerification::unreachable('o LinkedIn');
        }

        return match ($response->json('error')) {
            'invalid_client', 'unauthorized_client' => AppVerification::invalid('O LinkedIn recusou o Client ID ou o Client Secret. Confira os dois na aba Auth do app.'),
            'invalid_request', 'invalid_grant' => AppVerification::verified('O LinkedIn reconheceu o Client ID e o Client Secret.'),
            default => AppVerification::unreachable('o LinkedIn'),
        };
    }

    public static function rest(string $token): PendingRequest
    {
        $version = config('services.linkedin.api_version');

        return Http::timeout(30)->acceptJson()->withToken($token)->withHeaders([
            'LinkedIn-Version' => is_string($version) && $version !== '' ? $version : '202410',
            'X-Restli-Protocol-Version' => '2.0.0',
        ]);
    }

    /** @param callable(): Response $request */
    private function call(callable $request, string $what): Response
    {
        try {
            $response = $request();
        } catch (ConnectionException) {
            throw new OAuthException('Não foi possível falar com o LinkedIn agora. Tente de novo em instantes.');
        }
        if ($response->failed()) {
            throw OAuthException::platform($what);
        }

        return $response;
    }

    private function app(): AppCredentials
    {
        return $this->apps->credentials(AppVendor::Linkedin)
            ?? throw new OAuthException('Login real indisponível: falta cadastrar o app do LinkedIn em Integrações › Apps das plataformas.');
    }
}
