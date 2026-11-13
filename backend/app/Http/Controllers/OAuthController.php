<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\OAuth\OAuthException;
use App\Domain\Integrations\OAuth\OAuthFlow;
use App\Domain\Integrations\OAuth\OAuthResult;
use App\Domain\Metrics\Catalog\Catalog;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;

/**
 * Login das plataformas em pop-up (rotas web, servidas na origem do app via proxy).
 *
 *  GET /oauth/{provider}/start     abre o fluxo e redireciona para a tela de autorização
 *  GET /oauth/{provider}/callback  retorno da plataforma: conclui e avisa a janela do app
 *  GET /oauth/{provider}/demo      tela de autorização do modo demonstração
 */
final class OAuthController extends Controller
{
    public function __construct(
        private readonly OAuthFlow $flow,
        private readonly Catalog $catalog,
    ) {}

    public function start(Request $request, string $provider): Response|RedirectResponse
    {
        $flow = self::flowId($request);
        $return = $request->query('return') === 'redirect' ? 'redirect' : 'popup';
        $mode = $request->query('mode') === 'live' ? 'live' : 'sandbox';
        $tenantId = $request->string('tenant_id')->toString();

        // Delta Connect: sessão hospedada (sem login), identificada pelo token do link (ADR 0032).
        $session = $request->query('connect_session');
        if (is_string($session) && preg_match('/^[A-Za-z0-9]{48}$/', $session) === 1 && $flow !== null) {
            try {
                return redirect()->away($this->flow->startForSession($session, $provider, $mode, $flow, $return));
            } catch (OAuthException $e) {
                return $this->finish(OAuthResult::error($provider, $flow, $return, $e->getMessage()));
            }
        }

        if ($flow === null || ! Str::isUuid($tenantId)) {
            return $this->finish(OAuthResult::error($provider, $flow, $return, 'Pedido de conexão inválido. Comece de novo pela tela de Integrações.'));
        }

        try {
            $url = $this->flow->start(self::user($request), $tenantId, $provider, $mode, $flow, $return);
        } catch (OAuthException $e) {
            return $this->finish(OAuthResult::error($provider, $flow, $return, $e->getMessage()));
        }

        return redirect()->away($url);
    }

    public function callback(Request $request, string $provider): Response|RedirectResponse
    {
        $result = $this->flow->complete(
            self::user($request),
            $provider,
            $request->string('state')->toString(),
            // O TikTok for Business devolve "auth_code" em vez de "code".
            $request->filled('code') ? $request->string('code')->toString() : ($request->filled('auth_code') ? $request->string('auth_code')->toString() : null),
            $request->filled('error') ? $request->string('error')->toString() : null,
        );

        return $this->finish($result);
    }

    /** Tela de autorização de demonstração (simula a página da plataforma, sem pedir senha). */
    public function demo(Request $request, string $provider): Response
    {
        $state = $request->string('state')->toString();
        $callback = "/oauth/{$provider}/callback?";
        $nonce = Str::random(24);

        return $this->secure(response()->view('oauth.demo', [
            'nonce' => $nonce,
            'platform' => $this->catalog->provider($provider)?->name() ?? ConnectionManager::DESTINATIONS[$provider] ?? $provider,
            'authorizeUrl' => $callback.http_build_query(['state' => $state, 'code' => 'demo_'.Str::random(24)]),
            'cancelUrl' => $callback.http_build_query(['state' => $state, 'error' => 'access_denied']),
        ]), $nonce);
    }

    private function finish(OAuthResult $result): Response|RedirectResponse
    {
        $frontend = rtrim(self::frontendUrl(), '/');

        if ($result->returnMode === 'redirect') {
            return redirect()->away($frontend.'/integracoes?'.http_build_query(array_filter([
                'oauth' => $result->status,
                'provider' => $result->provider,
                'connection_id' => $result->connectionId,
                'message' => $result->message,
            ])));
        }

        $nonce = Str::random(24);

        return $this->secure(response()->view('oauth.result', [
            'nonce' => $nonce,
            'result' => $result,
            'message' => $result->toMessage(),
            'origin' => $frontend,
            'platform' => $this->catalog->provider($result->provider)?->name() ?? ConnectionManager::DESTINATIONS[$result->provider] ?? 'a plataforma',
        ], $result->status === 'error' ? 400 : 200), $nonce);
    }

    /**
     * Cabeçalhos das páginas do fluxo: CSP estrita com nonce e COOP "unsafe-none", para não
     * cortar o vínculo do pop-up com a janela do app (o resultado também vai por
     * BroadcastChannel e localStorage, caso a plataforma corte esse vínculo do lado dela).
     */
    private function secure(Response $response, string $nonce): Response
    {
        return $response->withHeaders([
            'Content-Security-Policy' => "default-src 'none'; script-src 'nonce-{$nonce}'; style-src 'nonce-{$nonce}'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            'Cross-Origin-Opener-Policy' => 'unsafe-none',
            'Cache-Control' => 'no-store',
            'Referrer-Policy' => 'no-referrer',
        ]);
    }

    private static function flowId(Request $request): ?string
    {
        $flow = $request->query('flow');

        return is_string($flow) && preg_match('/^[A-Za-z0-9_-]{16,64}$/', $flow) === 1 ? $flow : null;
    }

    private static function user(Request $request): ?User
    {
        $user = $request->user();

        return $user instanceof User ? $user : null;
    }

    private static function frontendUrl(): string
    {
        $url = config('delta.frontend_url');

        return is_string($url) ? $url : '';
    }
}
