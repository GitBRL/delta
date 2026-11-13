<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Billing\Entitlements;
use App\Models\Subscription;
use App\Support\Tenancy\TenantContext;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Administração: define o plano de uma agência (enquanto o provedor de pagamento não está
 * integrado, ou para cortesias). Roda sem usuário no contexto, como exige o RLS (ADR 0031).
 */
#[Signature('billing:plan {tenant : id da agência} {plan : essencial, pro, agencia ou trial} {--status=active : trialing, active, past_due ou canceled} {--days=30 : dias do período (ou do teste)}')]
#[Description('Define o plano e a situação da assinatura de uma agência')]
final class SetTenantPlan extends Command
{
    public function handle(TenantContext $context): int
    {
        $tenant = (string) $this->argument('tenant');
        $plan = (string) $this->argument('plan');
        $status = (string) $this->option('status');
        $days = (int) $this->option('days');

        if (! Str::isUuid($tenant) || ($plan !== 'trial' && ! array_key_exists($plan, Entitlements::plans())) || ! in_array($status, ['trialing', 'active', 'past_due', 'canceled'], true)) {
            $this->error('Agência, plano ou situação inválidos.');

            return self::INVALID;
        }

        $context->run($tenant, null, function () use ($plan, $status, $days): void {
            $subscription = Subscription::query()->first() ?? new Subscription;
            $subscription->forceFill([
                'plan' => $plan,
                'status' => $status,
                'trial_ends_at' => $status === 'trialing' ? now()->addDays($days) : $subscription->trial_ends_at,
                'current_period_ends_at' => $status === 'active' ? now()->addDays($days) : $subscription->current_period_ends_at,
                'canceled_at' => $status === 'canceled' ? now() : null,
                'provider' => 'manual',
            ])->save();
        });

        $this->info("Agência {$tenant}: plano {$plan} ({$status}).");

        return self::SUCCESS;
    }
}
