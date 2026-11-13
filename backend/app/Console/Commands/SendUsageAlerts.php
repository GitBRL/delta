<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Billing\UsageAlerts;
use App\Support\Tenancy\TenantContext;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Avisos de franquia (80% e 100%) de todas as agências; ids pela função estreita, o resto sob RLS. */
#[Signature('billing:usage-alerts')]
#[Description('Avisa dono e administradores quando a franquia do mês passa de 80% ou acaba')]
final class SendUsageAlerts extends Command
{
    public function handle(TenantContext $context, UsageAlerts $alerts): int
    {
        $sent = 0;
        foreach (DB::select('select tenant_id from app.tenants_with_projects()') as $row) {
            if (is_object($row) && is_string($row->tenant_id ?? null)) {
                $sent += $context->run($row->tenant_id, null, fn (): int => $alerts->check());
            }
        }

        $this->info("{$sent} aviso(s) de franquia.");

        return self::SUCCESS;
    }
}
