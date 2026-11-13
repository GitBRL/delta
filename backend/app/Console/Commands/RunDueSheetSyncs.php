<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\RunSheetSync;
use App\Support\Tenancy\TenantContext;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * A cada hora: dispara as exportações para Google Sheets vencidas (diárias ou semanais).
 * Listagem entre agências só de ids; o resto roda sob RLS (ADR 0012, ADR 0027).
 */
#[Signature('sheets:sync-due')]
#[Description('Dispara as exportações para Google Sheets vencidas')]
final class RunDueSheetSyncs extends Command
{
    public function handle(TenantContext $context): int
    {
        /** @var list<object{tenant_id: string, sync_id: string}> $rows */
        $rows = DB::select('select * from app.due_sheet_syncs(now())');

        foreach ($rows as $row) {
            $context->run($row->tenant_id, null, fn () => RunSheetSync::dispatch($row->sync_id));
        }

        $this->info(count($rows).' exportação(ões) disparada(s).');

        return self::SUCCESS;
    }
}
