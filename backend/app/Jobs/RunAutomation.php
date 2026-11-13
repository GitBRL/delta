<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Domain\Automations\AutomationRunner;
use App\Support\Tenancy\TenantScopedJob;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Execução agendada de um envio automático (no contexto da agência dona). */
final class RunAutomation implements ShouldBeUnique, ShouldQueue
{
    use Queueable, TenantScopedJob;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [30, 120, 600];

    public int $uniqueFor = 300;

    public function __construct(public readonly string $automationId)
    {
        $this->captureTenantContext();
    }

    public function uniqueId(): string
    {
        return $this->automationId;
    }

    public function handle(AutomationRunner $runner): void
    {
        $runner->runScheduled($this->automationId, CarbonImmutable::now());
    }
}
