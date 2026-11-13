<?php

declare(strict_types=1);

namespace App\Domain\Reports;

use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Timeline\Timeline;
use App\Domain\Webhooks\Webhooks;
use App\Jobs\RenderSnapshotPdf;
use App\Models\Report;
use App\Models\ReportSnapshot;
use App\Support\Tenancy\TenantContext;

/**
 * Publica um relatório: congela os números do período num snapshot imutável e manda gerar
 * o PDF. O mesmo snapshot alimenta o link público, o PDF e os envios automáticos.
 */
final readonly class ReportPublisher
{
    public function __construct(
        private ReportRenderer $renderer,
        private Catalog $catalog,
        private TenantContext $context,
        private Timeline $timeline,
    ) {}

    public function publish(Report $report, ?ReportPeriod $period = null): ReportSnapshot
    {
        $period ??= $report->period();
        $project = $report->project()->firstOrFail();
        $set = MetricSet::forCurrentTenant($this->catalog);
        $layout = ReportLayout::normalize($report->layout, $set);

        $data = $this->renderer->render($project, $report->title, $layout, $period, $report->compare, $set);
        $comparison = $report->compare->shift($period->start, $period->end);

        $snapshot = ReportSnapshot::query()->create([
            'report_id' => $report->id,
            'project_id' => $project->id,
            'title' => $report->title,
            'period_start' => $period->start->toDateString(),
            'period_end' => $period->end->toDateString(),
            'compare_start' => $comparison[0] ?? null,
            'compare_end' => $comparison[1] ?? null,
            'data' => $data,
            'pdf_status' => 'pending',
            'created_by' => $this->context->userId(),
        ]);

        RenderSnapshotPdf::dispatch($snapshot->id);
        $this->timeline->record($project->id, 'report_published', "Relatório publicado: {$report->title}", $period->label(), metadata: ['snapshot_id' => $snapshot->id]);
        Webhooks::emit('report.published', [
            'snapshot_id' => $snapshot->id, 'report_id' => $report->id, 'project_id' => $project->id, 'title' => $report->title,
            'period' => ['start' => $period->start->toDateString(), 'end' => $period->end->toDateString()],
        ]);

        return $snapshot;
    }
}
