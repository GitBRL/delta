<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Goals\GoalMonitor;
use App\Support\Tenancy\TenantContext;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Avalia as metas de todas as agências (ids via função estreita; o resto sob RLS). ADR 0017. */
#[Signature('goals:evaluate')]
#[Description('Avalia as metas e avisa a equipe quando alguma muda de estado')]
final class EvaluateGoals extends Command
{
    public function handle(TenantContext $context, GoalMonitor $monitor): int
    {
        $alerts = 0;
        foreach (DB::select('select tenant_id from app.tenants_with_active_goals()') as $row) {
            if (is_object($row) && is_string($row->tenant_id ?? null)) {
                $alerts += $context->run($row->tenant_id, null, fn (): int => $monitor->evaluate());
            }
        }

        $this->info("{$alerts} alerta(s) de meta.");

        return self::SUCCESS;
    }
}
