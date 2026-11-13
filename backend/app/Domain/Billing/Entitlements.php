<?php

declare(strict_types=1);

namespace App\Domain\Billing;

use App\Domain\Integrations\ConnectionManager;
use App\Models\Automation;
use App\Models\IntegrationConnection;
use App\Models\Project;
use App\Models\Subscription;
use App\Models\Tenant;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * O que o plano da agência do contexto permite (ADR 0031). Leitura nunca é bloqueada: só criar
 * além do limite, usar recurso fora do plano ou consumir além da franquia do mês.
 *
 * Agência sem assinatura gravada (criada antes do billing) = teste grátis contado da criação.
 */
final readonly class Entitlements
{
    public const COUNTED = ['projects', 'seats', 'live_connections', 'automations'];

    public const METERED = ['whatsapp_messages', 'ai_tokens'];

    private const LIMIT_LABELS = [
        'projects' => 'projetos',
        'seats' => 'pessoas na equipe',
        'live_connections' => 'conexões reais com plataformas',
        'automations' => 'envios automáticos',
        'whatsapp_messages' => 'mensagens de WhatsApp no mês',
        'ai_tokens' => 'tokens de IA no mês',
    ];

    private const FEATURE_LABELS = [
        'api' => 'API pública e webhooks',
        'mcp' => 'assistentes de IA (MCP)',
        'white_label' => 'marca própria (domínio e selo)',
        'publishing' => 'Publicações',
        'studio' => 'Studio',
        'ads_management' => 'gestão de anúncios',
    ];

    public function __construct(private TenantContext $context) {}

    /**
     * @return array{plan: string, name: string, status: 'trialing'|'active'|'past_due'|'canceled', usable: bool, trial_ends_at: string|null, current_period_ends_at: string|null, price_brl: int|null, limits: array<string, int|null>, features: array<string, bool>}
     */
    public function current(): array
    {
        $subscription = Subscription::query()->first();
        if ($subscription === null) {
            $created = Tenant::query()->whereKey($this->context->tenantId())->value('created_at');
            $trialEnds = CarbonImmutable::parse(is_string($created) || $created instanceof \DateTimeInterface ? $created : 'now')->addDays(self::trialDays());
            $planKey = 'trial';
            $status = 'trialing';
            $periodEnds = null;
        } else {
            $trialEnds = $subscription->trial_ends_at === null ? null : CarbonImmutable::parse($subscription->trial_ends_at);
            $planKey = $subscription->plan;
            $status = $subscription->status;
            $periodEnds = $subscription->current_period_ends_at?->toIso8601String();
        }

        $spec = self::spec($planKey);
        $usable = match ($status) {
            'trialing' => $trialEnds === null || $trialEnds->isFuture(),
            'active', 'past_due' => true, // inadimplência: carência até o provedor cancelar
            'canceled' => false,
        };

        return [
            'plan' => $planKey,
            'name' => $planKey === 'trial' ? 'Teste grátis' : $spec['name'],
            'status' => $status,
            'usable' => $usable,
            'trial_ends_at' => $trialEnds?->toIso8601String(),
            'current_period_ends_at' => $periodEnds,
            'price_brl' => $spec['price_brl'],
            'limits' => $spec['limits'],
            'features' => $spec['features'],
        ];
    }

    /** @return array<string, int> uso atual de cada limite contado e da franquia do mês */
    public function usage(): array
    {
        $month = CarbonImmutable::now()->startOfMonth();

        return [
            'projects' => Project::query()->count(),
            'seats' => DB::table('tenant_user')->where('tenant_id', $this->context->tenantId())->where('role', '<>', 'client')->count()
                + DB::table('invitations')->whereNull('accepted_at')->whereNull('revoked_at')->where('expires_at', '>', now())->where('role', '<>', 'client')->count(),
            'live_connections' => IntegrationConnection::query()->where('mode', 'live')->whereNotIn('provider', array_keys(ConnectionManager::DESTINATIONS))->count(),
            'automations' => Automation::query()->count(),
            'whatsapp_messages' => DB::table('messages')->where('channel', 'whatsapp')->whereIn('status', ['sent', 'delivered', 'read'])->where('created_at', '>=', $month)->count()
                + DB::table('whatsapp_messages')->where('direction', 'out')->where('created_at', '>=', $month)->count(),
            'ai_tokens' => (int) DB::table('ai_usage')->where('created_at', '>=', $month)->sum(DB::raw('input_tokens + output_tokens')),
        ];
    }

    /** Cria mais um? Lança 402 se o plano não permite ou se o limite já foi atingido. */
    public function ensure(string $limit, int $adding = 1): void
    {
        $plan = $this->ensureUsable();
        $allowed = $plan['limits'][$limit] ?? null;
        if ($allowed === null) {
            return;
        }

        $used = $this->usage()[$limit];
        if ($used + $adding > $allowed) {
            throw new PlanLimitException(
                "O plano {$plan['name']} permite até {$allowed} ".self::LIMIT_LABELS[$limit]." (em uso: {$used}). Mude de plano em Configurações › Plano para continuar.",
                $limit, $allowed, $used,
            );
        }
    }

    public function ensureFeature(string $feature): void
    {
        $plan = $this->ensureUsable();
        if (! ($plan['features'][$feature] ?? false)) {
            throw new PlanLimitException(ucfirst(self::FEATURE_LABELS[$feature] ?? $feature)." não faz parte do plano {$plan['name']}. Mude de plano em Configurações › Plano.", $feature);
        }
    }

    /** Quanto ainda cabe na franquia do mês (null = sem limite; 0 = esgotada ou plano inativo). */
    public function remaining(string $metered): ?int
    {
        $plan = $this->current();
        if (! $plan['usable']) {
            return 0;
        }
        $allowed = $plan['limits'][$metered] ?? null;

        return $allowed === null ? null : max(0, $allowed - $this->usage()[$metered]);
    }

    /** @return array{plan: string, name: string, status: string, usable: bool, trial_ends_at: string|null, current_period_ends_at: string|null, price_brl: int|null, limits: array<string, int|null>, features: array<string, bool>} */
    private function ensureUsable(): array
    {
        $plan = $this->current();
        if (! $plan['usable']) {
            throw new PlanLimitException($plan['status'] === 'trialing'
                ? 'O período de teste da agência terminou. Escolha um plano em Configurações › Plano para continuar criando; tudo o que já existe continua disponível.'
                : 'A assinatura da agência está cancelada. Reative em Configurações › Plano para continuar criando; tudo o que já existe continua disponível.', 'plan');
        }

        return $plan;
    }

    public static function trialDays(): int
    {
        $days = config('billing.trial_days');

        return is_int($days) ? $days : 14;
    }

    /** @return array{name: string, price_brl: int|null, limits: array<string, int|null>, features: array<string, bool>} */
    public static function spec(string $plan): array
    {
        $trialPlan = config('billing.trial_plan');
        $key = $plan === 'trial' ? (is_string($trialPlan) ? $trialPlan : 'pro') : $plan;
        $spec = config("billing.plans.{$key}");
        if (! is_array($spec)) {
            $spec = config('billing.plans.essencial');
        }

        /** @var array{name: string, price_brl: int|null, limits: array<string, int|null>, features: array<string, bool>} $spec */
        return $spec;
    }

    /** @return array<string, array{name: string, price_brl: int|null, limits: array<string, int|null>, features: array<string, bool>}> */
    public static function plans(): array
    {
        $plans = config('billing.plans');

        /** @var array<string, array{name: string, price_brl: int|null, limits: array<string, int|null>, features: array<string, bool>}> */
        return is_array($plans) ? $plans : [];
    }
}
