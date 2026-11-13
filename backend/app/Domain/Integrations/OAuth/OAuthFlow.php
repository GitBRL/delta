<?php

declare(strict_types=1);

namespace App\Domain\Integrations\OAuth;

use App\Domain\Billing\Entitlements;
use App\Domain\Billing\PlanLimitException;
use App\Domain\Integrations\ConnectionManager;
use App\Domain\Webhooks\Webhooks;
use App\Models\ConnectCustomer;
use App\Models\ConnectSession;
use App\Models\IntegrationConnection;
use App\Models\OAuthState;
use App\Models\Project;
use App\Models\TenantMembership;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * Login de plataformas em pop-up ("um clique"), com as proteções de OAuth:
 *  - state aleatório de uso único, preso ao usuário e à agência, válido por 10 minutos;
 *  - PKCE (S256) onde a plataforma suporta;
 *  - só a equipe da agência pode conectar contas;
 *  - tokens guardados criptografados; nada sensível volta para o navegador.
 *
 * O state é "{tenant_id}.{aleatório}": no retorno, a agência sai do próprio state e o registro
 * é buscado sob RLS (sem funções que ignorem o isolamento). Só o hash do state é guardado.
 */
final readonly class OAuthFlow
{
    public const TTL_MINUTES = 10;

    public function __construct(
        private OAuthRegistry $registry,
        private TenantContext $context,
        private ConnectionManager $connections,
    ) {}

    /** @return string URL da tela de autorização (absoluta da plataforma, ou relativa na demonstração) */
    public function start(?User $user, string $tenantId, string $platform, string $mode, string $flow, string $returnMode): string
    {
        $this->authorize($user, $tenantId);

        return $this->begin($tenantId, $platform, $mode, $flow, $returnMode, $user?->id, null);
    }

    /**
     * Delta Connect (ADR 0032): sessão hospedada, sem login, só nas plataformas que o merchant
     * liberou. A sessão é achada pelo hash do token; o resto roda no contexto da agência.
     */
    public function startForSession(string $sessionToken, string $platform, string $mode, string $flow, string $returnMode): string
    {
        $session = $this->connectSession($sessionToken);
        if (! in_array($platform, $session->platforms, true)) {
            throw new OAuthException('Esta plataforma não foi liberada neste link de conexão.');
        }

        return $this->begin($session->tenant_id, $platform, $mode, $flow, $returnMode, null, $session->id);
    }

    private function begin(string $tenantId, string $platform, string $mode, string $flow, string $returnMode, ?string $userId, ?string $sessionId): string
    {
        $provider = $this->registry->for($platform, $mode);
        if ($mode === 'live' && ! ConnectionManager::isDestination($platform)) {
            try {
                app(Entitlements::class)->ensure('live_connections');
            } catch (PlanLimitException $e) {
                throw new OAuthException($e->getMessage());
            }
        }

        if (! $provider->isConfigured($platform)) {
            throw new OAuthException($this->registry->liveNote($platform) ?? 'Login real indisponível para esta plataforma.');
        }

        $state = $tenantId.'.'.Str::random(43);
        $verifier = $provider->usesPkce() ? Str::random(64) : null;
        $redirectUri = self::redirectUri($platform);

        OAuthState::query()->create([
            'user_id' => $userId,
            'connect_session_id' => $sessionId,
            'provider' => $platform,
            'mode' => $mode,
            'flow' => $flow,
            'return_mode' => $returnMode,
            'state_hash' => hash('sha256', $state),
            'code_verifier' => $verifier,
            'redirect_uri' => $redirectUri,
            'expires_at' => now()->addMinutes(self::TTL_MINUTES),
        ]);

        return $provider->authorizationUrl($platform, $state, $redirectUri, $verifier === null ? null : self::challenge($verifier));
    }

    public function complete(?User $user, string $platform, string $state, ?string $code, ?string $error): OAuthResult
    {
        $tenantId = explode('.', $state, 2)[0];
        if (! Str::isUuid($tenantId) || strlen($state) !== 80) {
            return OAuthResult::error($platform, null, 'popup', 'Pedido de conexão inválido. Comece de novo pela tela de Integrações.');
        }

        // Estado lido no contexto da agência (sem usuário): pode ser de uma sessão hospedada do Connect.
        $this->context->set($tenantId, null);
        $row = OAuthState::query()->where('state_hash', hash('sha256', $state))->first();
        $session = $row?->connect_session_id !== null ? ConnectSession::query()->find($row->connect_session_id) : null;

        if ($row?->connect_session_id !== null) {
            if ($session === null || $session->expires_at->isPast()) {
                return OAuthResult::error($platform, $row->flow, $row->return_mode, 'Este link de conexão expirou. Peça um novo a quem enviou.');
            }
        } else {
            try {
                $this->authorize($user, $tenantId);
            } catch (OAuthException $e) {
                return OAuthResult::error($platform, null, 'popup', $e->getMessage());
            }
        }

        if ($row === null || $row->provider !== $platform || ($session === null && $row->user_id !== $user?->id) || $row->used_at !== null || $row->expires_at->isPast()) {
            return OAuthResult::error($platform, $row?->flow, $row->return_mode ?? 'popup', 'Este pedido de conexão expirou ou já foi usado. Comece de novo.');
        }

        // Uso único: marcado antes de qualquer chamada à plataforma.
        $row->forceFill(['used_at' => now()])->save();
        $fail = fn (string $message): OAuthResult => OAuthResult::error($platform, $row->flow, $row->return_mode, $message);

        if ($error !== null) {
            return $error === 'access_denied'
                ? new OAuthResult('cancelled', $platform, $row->flow, $row->return_mode, null, 'Conexão cancelada.')
                : $fail('A plataforma não concluiu a autorização.');
        }

        if ($code === null || $code === '') {
            return $fail('A plataforma não devolveu a autorização.');
        }

        try {
            $provider = $this->registry->for($platform, $row->mode);
            $tokens = $provider->exchange($platform, $code, $row->redirect_uri, $row->code_verifier);
            $userId = $session === null ? $user?->id : null;

            if (ConnectionManager::isDestination($platform)) {
                $account = $row->mode === 'sandbox' ? null : ($provider->discoverAccounts($platform, $tokens)[0] ?? null);
                if ($row->mode !== 'sandbox' && $account === null) {
                    return $fail('A autorização funcionou, mas o Google não identificou a conta. Tente de novo.');
                }
                $connection = $this->connections->connectDestination($platform, $row->mode, $tokens, $account, $userId);
            } elseif ($row->mode === 'sandbox') {
                $connection = $this->connections->connectSandbox($platform, $userId);
            } else {
                $accounts = $provider->discoverAccounts($platform, $tokens);
                if ($accounts === []) {
                    return $fail('A autorização funcionou, mas nenhuma conta desta plataforma está disponível para o seu usuário.');
                }
                $connection = $this->connections->connectLive($platform, $tokens, $accounts, $userId);
            }
        } catch (OAuthException $e) {
            return $fail($e->getMessage());
        } catch (Throwable $e) {
            Log::error('Falha ao concluir login OAuth', ['platform' => $platform, 'exception' => $e]);

            return $fail('Não foi possível concluir a conexão agora. Tente de novo em instantes.');
        }

        if ($session !== null) {
            $this->linkToCustomer($session, $connection);
        }

        return new OAuthResult('success', $platform, $row->flow, $row->return_mode, $connection->id);
    }

    /** Sessão hospedada válida (contexto da agência dela, sem usuário). */
    private function connectSession(string $token): ConnectSession
    {
        /** @var object{session_id: string, tenant_id: string, expires_at: string}|null $found */
        $found = DB::selectOne('select * from app.connect_session_by_token(?)', [hash('sha256', $token)]);
        if ($found === null || CarbonImmutable::parse($found->expires_at)->isPast()) {
            throw new OAuthException('Este link de conexão expirou ou é inválido. Peça um novo a quem enviou.');
        }

        $this->context->set($found->tenant_id, null);

        return ConnectSession::query()->findOrFail($found->session_id);
    }

    /** Contas conectadas pela sessão hospedada vão direto para o projeto do customer. */
    private function linkToCustomer(ConnectSession $session, IntegrationConnection $connection): void
    {
        $accounts = $connection->accounts()->pluck('id')->all();
        Project::query()->findOrFail($session->project_id)->accounts()->syncWithoutDetaching($accounts);
        $session->forceFill(['connected' => array_values(array_unique([...$session->connected, $connection->id]))])->save();

        $customer = ConnectCustomer::query()->find($session->customer_id);
        Webhooks::emit('customer_integration.connected', [
            'customer_id' => $session->customer_id,
            'external_id' => $customer?->external_id,
            'provider' => $connection->provider,
            'mode' => $connection->mode,
            'accounts' => $connection->accounts()->get(['id', 'name', 'external_id'])->toArray(),
        ]);
    }

    /** Redirect cadastrado nos apps das plataformas: mesma origem do app (rota encaminhada à API). */
    public static function redirectUri(string $platform): string
    {
        $base = config('delta.frontend_url');

        return rtrim(is_string($base) ? $base : '', '/')."/oauth/{$platform}/callback";
    }

    private function authorize(?User $user, string $tenantId): void
    {
        if ($user === null) {
            throw new OAuthException('Sua sessão expirou. Entre de novo no Delta e tente conectar outra vez.');
        }

        $this->context->setUser($user->id);

        $membership = TenantMembership::query()->where('tenant_id', $tenantId)->where('user_id', $user->id)->first();

        if ($membership === null) {
            throw new OAuthException('Você não tem acesso a esta agência.');
        }

        if (! $membership->role->canManageProjects()) {
            throw new OAuthException('Só a equipe da agência pode conectar contas.');
        }

        $this->context->setTenant($tenantId);
    }

    private static function challenge(string $verifier): string
    {
        return rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
    }
}
