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
 * Login com o Facebook (app da Meta) para Meta Ads, páginas do Facebook e Instagram profissional.
 * A Meta não emite refresh token: o token curto é trocado por um de longa duração (~60 dias);
 * depois disso a conexão precisa ser refeita (ou migrada para token de usuário do sistema).
 * As credenciais do app vêm da agência (tela "Apps das plataformas") ou do servidor.
 */
final readonly class MetaOAuth implements OAuthProvider, VerifiesApp
{
    /** Escopos mínimos de leitura por plataforma. */
    private const SCOPES = [
        'meta_ads' => ['ads_read', 'business_management'],
        'facebook' => ['pages_show_list', 'pages_read_engagement', 'read_insights'],
        'instagram' => ['instagram_basic', 'instagram_manage_insights', 'pages_show_list', 'pages_read_engagement'],
    ];

    private const MAX_PAGES = 10;

    public function __construct(private PlatformApps $apps) {}

    public function isConfigured(string $platform): bool
    {
        return isset(self::SCOPES[$platform]) && $this->apps->credentials(AppVendor::Meta) !== null;
    }

    public function usesPkce(): bool
    {
        return false;
    }

    public function authorizationUrl(string $platform, string $state, string $redirectUri, ?string $codeChallenge): string
    {
        return 'https://www.facebook.com/'.self::version().'/dialog/oauth?'.http_build_query([
            'client_id' => $this->app()->clientId,
            'redirect_uri' => $redirectUri,
            'state' => $state,
            'response_type' => 'code',
            'scope' => implode(',', self::SCOPES[$platform] ?? []),
        ]);
    }

    public function exchange(string $platform, string $code, string $redirectUri, ?string $codeVerifier): OAuthTokens
    {
        $app = $this->app();
        $short = $this->tokenRequest([
            'client_id' => $app->clientId,
            'client_secret' => $app->clientSecret,
            'redirect_uri' => $redirectUri,
            'code' => $code,
        ], 'a autorização');

        // Token curto (~1-2 h) → token de longa duração (~60 dias).
        $long = $this->tokenRequest([
            'grant_type' => 'fb_exchange_token',
            'client_id' => $app->clientId,
            'client_secret' => $app->clientSecret,
            'fb_exchange_token' => $short['access_token'],
        ], 'o token de longa duração');

        return OAuthTokens::expiringIn($long['access_token'], $long['expires_in'] ?? null, null, self::SCOPES[$platform] ?? []);
    }

    /**
     * Pede um token de app (client_credentials): só sai com ID e chave secreta corretos.
     * Com ele, busca o nome do app para mostrar ao administrador o que foi reconhecido.
     */
    public function verifyApp(AppCredentials $app): AppVerification
    {
        $graph = 'https://graph.facebook.com/'.self::version();

        try {
            $response = Http::timeout(10)->acceptJson()->get("{$graph}/oauth/access_token", [
                'client_id' => $app->clientId,
                'client_secret' => $app->clientSecret,
                'grant_type' => 'client_credentials',
            ]);
        } catch (ConnectionException) {
            return AppVerification::unreachable('a Meta');
        }

        $token = $response->json('access_token');
        if ($response->serverError()) {
            return AppVerification::unreachable('a Meta');
        }
        if ($response->failed() || ! is_string($token) || $token === '') {
            return AppVerification::invalid('A Meta recusou o ID ou a chave secreta do app. Confira os dois em Configurações › Básico, no painel do app.');
        }

        $name = null;
        try {
            $info = Http::timeout(10)->acceptJson()->withToken($token)->get("{$graph}/".rawurlencode($app->clientId), ['fields' => 'name']);
            $name = $info->successful() ? $info->json('name') : null;
        } catch (ConnectionException) {
            // o nome é só um detalhe; as credenciais já foram confirmadas
        }

        return AppVerification::verified(is_string($name) && $name !== ''
            ? "A Meta confirmou as credenciais do app \"{$name}\"."
            : 'A Meta confirmou o ID e a chave secreta do app.');
    }

    public function discoverAccounts(string $platform, OAuthTokens $tokens): array
    {
        return match ($platform) {
            'meta_ads' => array_map(
                fn (array $a): DiscoveredAccount => new DiscoveredAccount(
                    externalId: 'act_'.self::str($a['account_id'] ?? ''),
                    name: self::str($a['name'] ?? 'Conta de anúncios'),
                    kind: 'ad_account',
                    currency: self::str($a['currency'] ?? '') ?: null,
                    timezone: self::str($a['timezone_name'] ?? '') ?: null,
                ),
                $this->paginate('/me/adaccounts', ['fields' => 'account_id,name,currency,timezone_name'], $tokens),
            ),
            'facebook' => array_map(
                fn (array $p): DiscoveredAccount => new DiscoveredAccount(self::str($p['id'] ?? ''), self::str($p['name'] ?? 'Página'), 'page'),
                $this->paginate('/me/accounts', ['fields' => 'id,name'], $tokens),
            ),
            'instagram' => $this->instagramAccounts($tokens),
            default => [],
        };
    }

    /** @return list<DiscoveredAccount> perfis profissionais ligados às páginas do usuário */
    private function instagramAccounts(OAuthTokens $tokens): array
    {
        $accounts = [];
        foreach ($this->paginate('/me/accounts', ['fields' => 'name,instagram_business_account{id,username,name}'], $tokens) as $page) {
            $ig = $page['instagram_business_account'] ?? null;
            if (is_array($ig) && isset($ig['id'])) {
                $username = self::str($ig['username'] ?? '');
                $accounts[] = new DiscoveredAccount(self::str($ig['id']), $username !== '' ? '@'.$username : self::str($ig['name'] ?? 'Instagram'), 'profile');
            }
        }

        return $accounts;
    }

    /**
     * @param  array<string, string>  $query
     * @return list<array<string, mixed>>
     */
    private function paginate(string $path, array $query, OAuthTokens $tokens): array
    {
        $items = [];
        $url = 'https://graph.facebook.com/'.self::version().$path;
        $params = [...$query, 'limit' => 200];

        for ($page = 0; $page < self::MAX_PAGES && $url !== null; $page++) {
            $response = $this->get($url, $params, 'a listagem de contas', $tokens->accessToken);
            $data = $response->json('data');
            foreach (is_array($data) ? $data : [] as $item) {
                if (is_array($item)) {
                    /** @var array<string, mixed> $item */
                    $items[] = $item;
                }
            }

            $next = $response->json('paging.next');
            $url = is_string($next) ? $next : null;
            $params = []; // a URL "next" já traz os parâmetros
        }

        return $items;
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array{access_token: string, expires_in: mixed}
     */
    private function tokenRequest(array $params, string $what): array
    {
        $response = $this->get('https://graph.facebook.com/'.self::version().'/oauth/access_token', $params, $what);
        $token = $response->json('access_token');

        if (! is_string($token) || $token === '') {
            throw OAuthException::platform($what);
        }

        return ['access_token' => $token, 'expires_in' => $response->json('expires_in')];
    }

    /** @param array<string, mixed> $params */
    private function get(string $url, array $params, string $what, ?string $token = null): Response
    {
        try {
            // Token no cabeçalho, não na URL (URLs acabam em logs).
            $request = Http::timeout(15)->retry(2, 200, throw: false)->acceptJson();
            $response = ($token === null ? $request : $request->withToken($token))->get($url, $params);
        } catch (ConnectionException) {
            throw new OAuthException('Não foi possível falar com a Meta agora. Tente de novo em instantes.');
        }

        if ($response->failed()) {
            throw OAuthException::platform($what);
        }

        return $response;
    }

    private function app(): AppCredentials
    {
        return $this->apps->credentials(AppVendor::Meta)
            ?? throw new OAuthException('Login real indisponível: falta cadastrar o app da Meta em Integrações › Apps das plataformas.');
    }

    private static function version(): string
    {
        $value = config('services.meta.graph_version');

        return is_string($value) && $value !== '' ? $value : 'v24.0';
    }

    private static function str(mixed $value): string
    {
        return is_scalar($value) ? (string) $value : '';
    }
}
