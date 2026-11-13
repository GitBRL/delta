<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Domain\Sync\SheetSyncRunner;
use App\Models\SheetSync;
use App\Support\Tenancy\TenantScopedJob;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Roda uma exportação para Google Sheets no contexto da agência (ADR 0027). */
final class RunSheetSync implements ShouldBeUnique, ShouldQueue
{
    use Queueable, TenantScopedJob;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [60, 300, 900];

    public int $uniqueFor = 600;

    public function __construct(public readonly string $syncId)
    {
        $this->captureTenantContext();
        $this->onQueue('metrics');
    }

    public function uniqueId(): string
    {
        return $this->syncId;
    }

    public function handle(SheetSyncRunner $runner): void
    {
        $sync = SheetSync::query()->find($this->syncId);
        if ($sync !== null && $sync->active) {
            $runner->run($sync);
        }
    }
}
