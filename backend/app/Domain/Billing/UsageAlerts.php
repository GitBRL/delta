<?php

declare(strict_types=1);

namespace App\Domain\Billing;

use App\Mail\UsageAlertMail;
use App\Models\TenantMembership;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantRole;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/**
 * Avisa dono e administradores quando a franquia do mês (WhatsApp, IA) passa de 80% e de 100%.
 * Cada limiar é avisado uma vez por mês (a tabela usage_alerts garante). ADR 0031.
 */
final readonly class UsageAlerts
{
    public const THRESHOLDS = [100, 80];

    private const LABELS = ['whatsapp_messages' => 'mensagens de WhatsApp', 'ai_tokens' => 'tokens de IA'];

    public function __construct(
        private Entitlements $entitlements,
        private TenantContext $context,
    ) {}

    /** @return int avisos novos enviados para a agência do contexto */
    public function check(): int
    {
        $plan = $this->entitlements->current();
        if (! $plan['usable']) {
            return 0;
        }

        $usage = $this->entitlements->usage();
        $period = now()->format('Y-m');
        $alerts = [];

        foreach (Entitlements::METERED as $metric) {
            $limit = $plan['limits'][$metric] ?? null;
            if ($limit === null || $limit <= 0) {
                continue;
            }
            $used = $usage[$metric];
            $pct = (int) floor($used * 100 / $limit);

            // Só o maior limiar atingido; o menor fica marcado para não chegar depois.
            foreach (self::THRESHOLDS as $threshold) {
                if ($pct < $threshold) {
                    continue;
                }
                $new = $this->mark($metric, $threshold, $period);
                if ($threshold === 100 && $pct >= 100) {
                    $this->mark($metric, 80, $period);
                }
                if ($new) {
                    $alerts[] = ['label' => self::LABELS[$metric], 'used' => $used, 'limit' => $limit, 'threshold' => $threshold];
                }
                break;
            }
        }

        $emails = $this->adminEmails();
        if ($alerts !== [] && $emails !== []) {
            Mail::to($emails)->queue(new UsageAlertMail($plan['name'], $alerts));
        }

        return count($alerts);
    }

    /** Marca o aviso do mês; false se já tinha sido enviado. */
    private function mark(string $metric, int $threshold, string $period): bool
    {
        try {
            DB::transaction(fn () => DB::table('usage_alerts')->insert([
                'tenant_id' => $this->context->tenantId(), 'metric' => $metric, 'threshold' => $threshold, 'period' => $period,
            ]));

            return true;
        } catch (UniqueConstraintViolationException) {
            return false;
        }
    }

    /** @return list<string> */
    private function adminEmails(): array
    {
        $ids = TenantMembership::query()->where('tenant_id', $this->context->tenantId())
            ->whereIn('role', [TenantRole::Owner->value, TenantRole::Admin->value])->pluck('user_id')->all();

        return array_values(array_filter(User::query()->whereIn('id', $ids)->pluck('email')->all(), 'is_string'));
    }
}
