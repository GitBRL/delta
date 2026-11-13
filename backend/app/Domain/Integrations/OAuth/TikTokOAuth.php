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
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Login do TikTok for Business (Marketing API). O token de anunciante não expira; o retorno
 * traz "auth_code". Contas = anunciantes autorizados. ADR 0024.
 */
final readonly class TikTokOAuth implements OAuthProvider, VerifiesApp
{
    public const API = 'https://business-api.tiktok.com/open_api/v1.3';

    public function __construct(private PlatformApps $apps) {}

    public function isConfigured(string $platform): bool
    {
        return $platform === 'tiktok_ads' && $this->apps->credentials(AppVendor::Tiktok) !== null;
    }

    public function usesPkce(): bool
    {
        return false;
    }

    public function authorizationUrl(string $platform, string $state, string $redirectUri, ?string $codeChallenge): string
    {
        return 'https://business-api.tiktok.com/portal/auth?'.http_build_query(['app_id' => $this->app()->clientId, 'state' => $state, 'redirect_uri' => $redirectUri]);
    }

    public function exchange(string $platform, string $code, string $redirectUri, ?string $codeVerifier): OAuthTokens
    {
        $app = $this->app();
        $response = $this->call(fn () => Http::timeout(15)->acceptJson()->post(self::API.'/oauth2/access_token/', [
            'app_id' => $app->clientId, 'secret' => $app->clientSecret, 'auth_code' => $code,
        ]), 'a autorização');

        $token = $response->json('data.access_token');
        if (! is_string($token) || $token === '') {
            throw OAuthException::platform('a autorização');
        }
        $scopes = $response->json('data.scope');

        return new OAuthTokens($token, null, null, is_array($scopes) ? array_values(array_map('strval', array_filter($scopes, 'is_scalar'))) : []);
    }

    public function discoverAccounts(string $platform, OAuthTokens $tokens): array
    {
        $app = $this->app();
        $response = $this->call(fn () => Http::timeout(15)->acceptJson()->withHeaders(['Access-Token' => $tokens->accessToken])
            ->get(self::API.'/oauth2/advertiser/get/', ['app_id' => $app->clientId, 'secret' => $app->clientSecret]), 'a listagem de anunciantes');

        $accounts = [];
        foreach ((array) $response->json('data.list') as $item) {
            $id = data_get($item, 'advertiser_id');
            $name = data_get($item, 'advertiser_name');
            if (is_scalar($id)) {
                $accounts[] = new DiscoveredAccount((string) $id, is_string($name) ? $name : 'Anunciante TikTok', 'ad_account');
            }
        }

        return $accounts;
    }

    /** O TikTok não tem token só do app: a verificação acontece na primeira conexão. */
    public function verifyApp(AppCredentials $app): AppVerification
    {
        return AppVerification::unverifiable('O TikTok não permite conferir o app sem autorizar um anunciante: ele será conferido na primeira conexão.');
    }

    /** @param callable(): Response $request */
    private function call(callable $request, string $what): Response
    {
        try {
            $response = $request();
        } catch (ConnectionException) {
            throw new OAuthException('Não foi possível falar com o TikTok agora. Tente de novo em instantes.');
        }

        // A Marketing API responde 200 com "code" diferente de 0 quando há erro.
        if ($response->failed() || $response->json('code') !== 0) {
            throw OAuthException::platform($what);
        }

        return $response;
    }

    private function app(): AppCredentials
    {
        return $this->apps->credentials(AppVendor::Tiktok)
            ?? throw new OAuthException('Login real indisponível: falta cadastrar o app do TikTok for Business em Integrações › Apps das plataformas.');
    }
}
