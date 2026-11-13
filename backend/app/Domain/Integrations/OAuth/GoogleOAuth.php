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
 * Login com o Google para GA4 e Google Ads. Usa PKCE (S256) e access_type=offline para
 * receber refresh token (prompt=consent garante que ele venha também em reconexões).
 * As credenciais do app vêm da agência (tela "Apps das plataformas") ou do servidor.
 */
final readonly class GoogleOAuth implements OAuthProvider, VerifiesApp
{
    private const SCOPES = [
        'ga4' => ['https://www.googleapis.com/auth/analytics.readonly'],
        'google_ads' => ['https://www.googleapis.com/auth/adwords'],
        'search_console' => ['https://www.googleapis.com/auth/webmasters.readonly'],
        'youtube' => ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly'],
        'google_business' => ['https://www.googleapis.com/auth/business.manage'],
        // Sync (ADR 0027): só os arquivos criados pelo próprio Delta, nada mais do Drive.
        'google_sheets' => ['https://www.googleapis.com/auth/drive.file'],
    ];

    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';

    public function __construct(private PlatformApps $apps) {}

    public function isConfigured(string $platform): bool
    {
        $app = isset(self::SCOPES[$platform]) ? $this->apps->credentials(AppVendor::Google) : null;

        // A API do Google Ads exige developer token até para listar as contas.
        return $app !== null && ($platform !== 'google_ads' || $app->hasDeveloperToken());
    }

    public function usesPkce(): bool
    {
        return true;
    }

    public function authorizationUrl(string $platform, string $state, string $redirectUri, ?string $codeChallenge): string
    {
        return 'https://accounts.google.com/o/oauth2/v2/auth?'.http_build_query(array_filter([
            'client_id' => $this->app()->clientId,
            'redirect_uri' => $redirectUri,
            'response_type' => 'code',
            'scope' => implode(' ', self::SCOPES[$platform] ?? []),
            'state' => $state,
            'access_type' => 'offline',
            'prompt' => 'consent',
            'include_granted_scopes' => 'true',
            'code_challenge' => $codeChallenge,
            'code_challenge_method' => $codeChallenge === null ? null : 'S256',
        ], fn (?string $v): bool => $v !== null));
    }

    public function exchange(string $platform, string $code, string $redirectUri, ?string $codeVerifier): OAuthTokens
    {
        $app = $this->app();
        $response = $this->send(fn () => Http::asForm()->timeout(15)->acceptJson()->post(self::TOKEN_URL, array_filter([
            'code' => $code,
            'client_id' => $app->clientId,
            'client_secret' => $app->clientSecret,
            'redirect_uri' => $redirectUri,
            'grant_type' => 'authorization_code',
            'code_verifier' => $codeVerifier,
        ], fn (?string $v): bool => $v !== null)), 'a autorização');

        $access = $response->json('access_token');
        if (! is_string($access) || $access === '') {
            throw OAuthException::platform('a autorização');
        }

        $refresh = $response->json('refresh_token');
        $scope = $response->json('scope');

        return OAuthTokens::expiringIn(
            $access,
            $response->json('expires_in'),
            is_string($refresh) ? $refresh : null,
            is_string($scope) ? array_values(array_filter(explode(' ', $scope))) : self::SCOPES[$platform] ?? [],
        );
    }

    /**
     * O Google não tem "token de app". Trocamos um código propositalmente inválido: com ID e
     * chave corretos a resposta é invalid_grant (o código é que é ruim); com credenciais
     * erradas é invalid_client. Nenhum dado de usuário é tocado.
     */
    public function verifyApp(AppCredentials $app): AppVerification
    {
        try {
            $response = Http::asForm()->timeout(10)->acceptJson()->post(self::TOKEN_URL, [
                'code' => 'delta-verificacao-de-credenciais',
                'client_id' => $app->clientId,
                'client_secret' => $app->clientSecret,
                'redirect_uri' => OAuthFlow::redirectUri('ga4'),
                'grant_type' => 'authorization_code',
            ]);
        } catch (ConnectionException) {
            return AppVerification::unreachable('o Google');
        }

        return match ($response->json('error')) {
            'invalid_grant' => AppVerification::verified('O Google confirmou o ID do cliente e a chave secreta.'
                .($app->hasDeveloperToken() ? ' O developer token do Google Ads é conferido na primeira conexão.' : '')),
            'invalid_client', 'unauthorized_client' => AppVerification::invalid('O Google recusou o ID do cliente ou a chave secreta. Confira os dois em APIs e serviços › Credenciais, no Google Cloud.'),
            'redirect_uri_mismatch' => AppVerification::invalid('O Google reconheceu o app, mas o endereço de retorno não está cadastrado nele. Adicione os URIs de redirecionamento mostrados nesta tela.'),
            default => AppVerification::unreachable('o Google'),
        };
    }

    public function discoverAccounts(string $platform, OAuthTokens $tokens): array
    {
        return match ($platform) {
            'ga4' => $this->ga4Properties($tokens),
            'google_ads' => $this->adsCustomers($tokens),
            'search_console' => $this->sites($tokens),
            'youtube' => $this->channels($tokens),
            'google_business' => $this->locations($tokens),
            'google_sheets' => $this->driveUser($tokens),
            default => [],
        };
    }

    /** @return list<DiscoveredAccount> a conta Google que autorizou (destino do Sync) */
    private function driveUser(OAuthTokens $tokens): array
    {
        $response = $this->send(fn () => Http::withToken($tokens->accessToken)->timeout(15)->acceptJson()
            ->get('https://www.googleapis.com/drive/v3/about', ['fields' => 'user(emailAddress,displayName)']), 'a identificação da conta Google');

        $email = $response->json('user.emailAddress');

        return is_string($email) && $email !== '' ? [new DiscoveredAccount($email, $email, 'google_account')] : [];
    }

    /** @return list<DiscoveredAccount> */
    private function ga4Properties(OAuthTokens $tokens): array
    {
        $response = $this->send(fn () => Http::withToken($tokens->accessToken)->timeout(15)->acceptJson()
            ->get('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', ['pageSize' => 200]), 'a listagem de propriedades');

        $accounts = [];
        $summaries = $response->json('accountSummaries');
        foreach (is_array($summaries) ? $summaries : [] as $summary) {
            $properties = is_array($summary) ? ($summary['propertySummaries'] ?? []) : [];
            foreach (is_array($properties) ? $properties : [] as $property) {
                if (! is_array($property) || ! is_string($property['property'] ?? null)) {
                    continue;
                }

                $accounts[] = new DiscoveredAccount(
                    externalId: $property['property'],
                    name: is_string($property['displayName'] ?? null) ? $property['displayName'] : $property['property'],
                    kind: 'property',
                );
            }
        }

        return $accounts;
    }

    /** @return list<DiscoveredAccount> */
    private function adsCustomers(OAuthTokens $tokens): array
    {
        $developerToken = $this->app()->developerToken
            ?? throw new OAuthException('Falta o developer token do Google Ads em Integrações › Apps das plataformas.');
        $version = config('services.google.ads_api_version');
        $version = is_string($version) && $version !== '' ? $version : 'v22';
        $response = $this->send(fn () => Http::withToken($tokens->accessToken)
            ->withHeaders(['developer-token' => $developerToken])
            ->timeout(15)->acceptJson()
            ->get("https://googleads.googleapis.com/{$version}/customers:listAccessibleCustomers"), 'a listagem de contas do Google Ads');

        $accounts = [];
        $names = $response->json('resourceNames');
        foreach (is_array($names) ? $names : [] as $resource) {
            if (! is_string($resource) || preg_match('/^customers\/(\d{10})$/', $resource, $m) !== 1) {
                continue;
            }

            $formatted = substr($m[1], 0, 3).'-'.substr($m[1], 3, 3).'-'.substr($m[1], 6);
            $accounts[] = new DiscoveredAccount($m[1], "Google Ads {$formatted}", 'ad_account');
        }

        return $accounts;
    }

    /** @return list<DiscoveredAccount> sites verificados no Search Console */
    private function sites(OAuthTokens $tokens): array
    {
        $response = $this->send(fn () => Http::withToken($tokens->accessToken)->timeout(15)->acceptJson()
            ->get('https://www.googleapis.com/webmasters/v3/sites'), 'a listagem de sites do Search Console');

        $accounts = [];
        $entries = $response->json('siteEntry');
        foreach (is_array($entries) ? $entries : [] as $entry) {
            $url = is_array($entry) ? ($entry['siteUrl'] ?? null) : null;
            if (is_string($url) && ($entry['permissionLevel'] ?? '') !== 'siteUnverifiedUser') {
                $accounts[] = new DiscoveredAccount($url, $url, 'site');
            }
        }

        return $accounts;
    }

    /** @return list<DiscoveredAccount> canais do YouTube do usuário */
    private function channels(OAuthTokens $tokens): array
    {
        $response = $this->send(fn () => Http::withToken($tokens->accessToken)->timeout(15)->acceptJson()
            ->get('https://www.googleapis.com/youtube/v3/channels', ['part' => 'snippet', 'mine' => 'true']), 'a listagem de canais do YouTube');

        $accounts = [];
        $items = $response->json('items');
        foreach (is_array($items) ? $items : [] as $item) {
            $id = is_array($item) ? ($item['id'] ?? null) : null;
            $title = data_get($item, 'snippet.title');
            if (is_string($id)) {
                $accounts[] = new DiscoveredAccount($id, is_string($title) ? $title : 'Canal do YouTube', 'channel');
            }
        }

        return $accounts;
    }

    /** @return list<DiscoveredAccount> unidades (locais) do Perfil da Empresa no Google */
    private function locations(OAuthTokens $tokens): array
    {
        $response = $this->send(fn () => Http::withToken($tokens->accessToken)->timeout(15)->acceptJson()
            ->get('https://mybusinessaccountmanagement.googleapis.com/v1/accounts'), 'a listagem de contas do Perfil da Empresa');

        $accounts = [];
        $list = $response->json('accounts');
        foreach (is_array($list) ? $list : [] as $account) {
            $name = is_array($account) ? ($account['name'] ?? null) : null;
            if (! is_string($name)) {
                continue;
            }
            $locations = $this->send(fn () => Http::withToken($tokens->accessToken)->timeout(15)->acceptJson()
                ->get("https://mybusinessbusinessinformation.googleapis.com/v1/{$name}/locations", ['readMask' => 'name,title', 'pageSize' => 100]), 'a listagem de unidades');
            $items = $locations->json('locations');
            foreach (is_array($items) ? $items : [] as $location) {
                $id = is_array($location) ? ($location['name'] ?? null) : null;
                $title = is_array($location) ? ($location['title'] ?? null) : null;
                if (is_string($id)) {
                    $accounts[] = new DiscoveredAccount($id, is_string($title) ? $title : 'Unidade', 'location');
                }
            }
        }

        return $accounts;
    }

    /** @param callable(): Response $request */
    private function send(callable $request, string $what): Response
    {
        try {
            $response = $request();
        } catch (ConnectionException) {
            throw new OAuthException('Não foi possível falar com o Google agora. Tente de novo em instantes.');
        }

        if ($response->failed()) {
            throw OAuthException::platform($what);
        }

        return $response;
    }

    private function app(): AppCredentials
    {
        return $this->apps->credentials(AppVendor::Google)
            ?? throw new OAuthException('Login real indisponível: falta cadastrar o app do Google em Integrações › Apps das plataformas.');
    }
}
