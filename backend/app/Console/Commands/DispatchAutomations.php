<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\RunAutomation;
use App\Support\Tenancy\TenantContext;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * A cada minuto: envios automáticos vencidos de todas as agências. app.due_automations devolve
 * só (agência, automação); cada execução roda em job no contexto da própria agência (ADR 0012).
 */
#[Signature('automations:dispatch')]
#[Description('Dispara os envios automáticos de relatório que venceram')]
final class DispatchAutomations extends Command
{
    public function handle(TenantContext $context): int
    {
        /** @var list<object{tenant_id: string, automation_id: string}> $due */
        $due = DB::select('select * from app.due_automations(?)', [now()]);

        foreach ($due as $row) {
            $context->run($row->tenant_id, null, fn () => RunAutomation::dispatch($row->automation_id));
        }

        $this->info(count($due).' envio(s) disparado(s).');

        return self::SUCCESS;
    }
}
