<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Domain\Reports\Pdf\SnapshotPdf;
use App\Models\ReportSnapshot;
use App\Support\Tenancy\TenantScopedJob;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/** Gera o PDF de um snapshot (fila "render", concorrência limitada pelo Gotenberg). */
final class RenderSnapshotPdf implements ShouldBeUnique, ShouldQueue
{
    use Queueable, TenantScopedJob;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [10, 60, 180];

    public int $timeout = 120;

    public function __construct(public readonly string $snapshotId)
    {
        $this->captureTenantContext();
        $this->onQueue('render');
    }

    public function uniqueId(): string
    {
        return $this->snapshotId;
    }

    public function handle(SnapshotPdf $pdf): void
    {
        $snapshot = ReportSnapshot::query()->find($this->snapshotId);
        if ($snapshot === null || $snapshot->pdf_status === 'ready') {
            return;
        }

        $path = $pdf->generate($snapshot);
        $snapshot->forceFill(['pdf_status' => 'ready', 'pdf_path' => $path, 'pdf_error' => null])->save();
    }

    public function failed(?Throwable $e): void
    {
        ReportSnapshot::query()->whereKey($this->snapshotId)->first()?->forceFill([
            'pdf_status' => 'failed',
            'pdf_error' => mb_substr('Não foi possível gerar o PDF agora. '.($e?->getMessage() ?? ''), 0, 300),
        ])->save();
    }
}
