<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Reports\ReportPublisher;
use App\Http\Controllers\Controller;
use App\Jobs\RenderSnapshotPdf;
use App\Models\Project;
use App\Models\Report;
use App\Models\ReportSnapshot;
use App\Models\ShareLink;
use App\Support\Audit\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Versões publicadas (snapshots). Publicar é da equipe; ler é de quem enxerga o projeto
 * (o cliente vê só os dos próprios projetos, pelo RLS).
 */
final class ReportSnapshotController extends Controller
{
    public function __construct(private readonly Audit $audit) {}

    public function index(Report $report): JsonResponse
    {
        return response()->json(['data' => $report->snapshots()->orderByDesc('created_at')->limit(100)->get()
            ->map(self::summary(...))->values()->all()]);
    }

    public function forProject(Project $project): JsonResponse
    {
        return response()->json(['data' => ReportSnapshot::query()->where('project_id', $project->id)
            ->orderByDesc('created_at')->limit(100)->get()->map(self::summary(...))->values()->all()]);
    }

    public function store(Report $report, ReportPublisher $publisher): JsonResponse
    {
        $snapshot = $publisher->publish($report);
        $this->audit->record('report.published', $snapshot, ['report_id' => $report->id]);

        return response()->json(['data' => [...self::summary($snapshot), 'data' => $snapshot->data]], 201);
    }

    public function show(ReportSnapshot $snapshot): JsonResponse
    {
        return response()->json(['data' => [...self::summary($snapshot), 'data' => $snapshot->data]]);
    }

    /** 200 com o arquivo; 202 enquanto gera; 409 se falhou (a equipe pode pedir de novo). */
    public function pdf(ReportSnapshot $snapshot): StreamedResponse|JsonResponse
    {
        if ($snapshot->pdf_status === 'ready' && $snapshot->pdf_path !== null && Storage::disk('local')->exists($snapshot->pdf_path)) {
            return Storage::disk('local')->download($snapshot->pdf_path, self::filename($snapshot), ['Content-Type' => 'application/pdf']);
        }

        return $snapshot->pdf_status === 'failed'
            ? response()->json(['status' => 'failed', 'message' => $snapshot->pdf_error ?? 'Não foi possível gerar o PDF.'], 409)
            : response()->json(['status' => 'pending', 'message' => 'O PDF está sendo gerado. Tente de novo em alguns segundos.'], 202);
    }

    public function retryPdf(ReportSnapshot $snapshot): JsonResponse
    {
        if ($snapshot->pdf_status !== 'ready') {
            $snapshot->forceFill(['pdf_status' => 'pending', 'pdf_error' => null])->save();
            RenderSnapshotPdf::dispatch($snapshot->id);
        }

        return response()->json(['data' => self::summary($snapshot)], 202);
    }

    public function destroy(ReportSnapshot $snapshot): Response
    {
        $this->audit->record('report.snapshot_deleted', $snapshot);
        if ($snapshot->pdf_path !== null) {
            Storage::disk('local')->delete($snapshot->pdf_path);
        }
        $snapshot->delete();

        return response()->noContent();
    }

    /** @return array<string, mixed> */
    public static function summary(ReportSnapshot $s): array
    {
        return [
            'id' => $s->id,
            'report_id' => $s->report_id,
            'project_id' => $s->project_id,
            'title' => $s->title,
            'period' => ['start' => $s->period_start->toDateString(), 'end' => $s->period_end->toDateString()],
            'comparison' => $s->compare_start === null || $s->compare_end === null ? null : ['start' => $s->compare_start->toDateString(), 'end' => $s->compare_end->toDateString()],
            'pdf_status' => $s->pdf_status,
            'pdf_error' => $s->pdf_error,
            'active_links' => ShareLink::query()->where('snapshot_id', $s->id)->whereNull('revoked_at')
                ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))->count(),
            'created_at' => $s->created_at?->toIso8601String(),
        ];
    }

    public static function filename(ReportSnapshot $s): string
    {
        return Str::slug($s->title).'-'.$s->period_start->format('Y-m-d').'-a-'.$s->period_end->format('Y-m-d').'.pdf';
    }
}
