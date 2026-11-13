<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Query\Comparison;
use App\Domain\Reports\ReportLayout;
use App\Domain\Reports\ReportPeriod;
use App\Domain\Reports\ReportRenderer;
use App\Domain\Reports\ReportTemplates;
use App\Http\Controllers\Controller;
use App\Http\Requests\SaveReportRequest;
use App\Models\Project;
use App\Models\Report;
use App\Models\ReportSnapshot;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

/** Montador de relatórios (equipe da agência). As versões publicadas ficam em ReportSnapshotController. */
final class ReportController extends Controller
{
    public function __construct(
        private readonly Catalog $catalog,
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $query = Report::query()->with('project:id,name,niche')->orderByDesc('updated_at');
        if (is_string($projectId = $request->query('project_id')) && $projectId !== '') {
            $query->where('project_id', $projectId);
        }

        $reports = $query->limit(200)->get();
        $latest = ReportSnapshot::query()
            ->whereIn('report_id', $reports->pluck('id')->all())
            ->selectRaw('report_id, max(created_at) as published_at, count(*) as versions')
            ->groupBy('report_id')
            ->get()
            ->keyBy('report_id');

        return response()->json(['data' => $reports->map(fn (Report $r): array => [
            ...$this->summary($r),
            'last_published_at' => self::iso($latest->get($r->id)?->getAttribute('published_at')),
            'versions' => is_numeric($v = $latest->get($r->id)?->getAttribute('versions')) ? (int) $v : 0,
        ])->values()->all()]);
    }

    public function store(SaveReportRequest $request): JsonResponse
    {
        $project = Project::query()->find($request->string('project_id')->toString())
            ?? throw ValidationException::withMessages(['project_id' => 'Projeto não encontrado.']);

        $template = $request->filled('template') ? $request->string('template')->toString() : ReportTemplates::forNiche($project->niche);
        $providers = $project->accounts()->pluck('provider')->unique()->values()->all();
        $layout = ReportLayout::normalize(ReportTemplates::build($template, array_values(array_filter($providers, 'is_string'))), $this->set());

        $preset = $request->string('period_preset', 'last_30')->toString();
        ReportPeriod::resolve($preset, self::date($request, 'period_start'), self::date($request, 'period_end'));

        $report = Report::query()->create([
            'project_id' => $project->id,
            'title' => $request->string('title')->toString(),
            'template' => $template,
            'period_preset' => $preset,
            'period_start' => $preset === 'custom' ? $request->input('period_start') : null,
            'period_end' => $preset === 'custom' ? $request->input('period_end') : null,
            'compare' => $request->string('compare', Comparison::PreviousPeriod->value)->toString(),
            'layout' => $layout,
            'created_by' => $this->context->userId(),
            'updated_by' => $this->context->userId(),
        ]);
        $this->audit->record('report.created', $report, ['template' => $template]);

        return response()->json(['data' => $this->full($report->load('project'))], 201);
    }

    public function show(Report $report): JsonResponse
    {
        return response()->json(['data' => $this->full($report->load('project'))]);
    }

    public function update(SaveReportRequest $request, Report $report): JsonResponse
    {
        $preset = $request->string('period_preset')->toString();
        ReportPeriod::resolve($preset, self::date($request, 'period_start'), self::date($request, 'period_end'));

        $report->fill([
            'title' => $request->string('title')->toString(),
            'period_preset' => $preset,
            'period_start' => $preset === 'custom' ? $request->input('period_start') : null,
            'period_end' => $preset === 'custom' ? $request->input('period_end') : null,
            'compare' => $request->string('compare')->toString(),
            'layout' => ReportLayout::normalize($request->input('layout'), $this->set()),
            'updated_by' => $this->context->userId(),
        ])->save();

        return response()->json(['data' => $this->full($report->load('project'))]);
    }

    public function destroy(Report $report): Response
    {
        $this->audit->record('report.deleted', $report, ['title' => $report->title]);
        $report->delete();

        return response()->noContent();
    }

    /** Prévia ao vivo: o que vier no corpo sobrepõe o salvo (para ver antes de salvar). */
    public function render(SaveReportRequest $request, Report $report, ReportRenderer $renderer): JsonResponse
    {
        $set = $this->set();
        $preset = $request->has('period_preset') ? $request->string('period_preset')->toString() : $report->period_preset;
        $period = $request->has('period_preset')
            ? ReportPeriod::resolve($preset, self::date($request, 'period_start'), self::date($request, 'period_end'))
            : $report->period();
        $compare = $request->has('compare') ? Comparison::from($request->string('compare')->toString()) : $report->compare;
        $layout = ReportLayout::normalize($request->has('layout') ? $request->input('layout') : $report->layout, $set);
        $title = $request->has('title') ? $request->string('title')->toString() : $report->title;

        return response()->json(['data' => $renderer->render($report->project()->firstOrFail(), $title, $layout, $period, $compare, $set)]);
    }

    private function set(): MetricSet
    {
        return MetricSet::forCurrentTenant($this->catalog);
    }

    /** @return array<string, mixed> */
    private function summary(Report $report): array
    {
        try {
            $period = $report->period()->label();
        } catch (ValidationException) {
            $period = null;
        }

        return [
            'id' => $report->id,
            'title' => $report->title,
            'project' => $report->project === null ? null : ['id' => $report->project->id, 'name' => $report->project->name, 'niche' => $report->project->niche],
            'template' => $report->template,
            'period_preset' => $report->period_preset,
            'period_label' => $period,
            'updated_at' => $report->updated_at?->toIso8601String(),
        ];
    }

    /** @return array<string, mixed> */
    private function full(Report $report): array
    {
        return [
            ...$this->summary($report),
            'period_start' => $report->period_start?->toDateString(),
            'period_end' => $report->period_end?->toDateString(),
            'compare' => $report->compare->value,
            'layout' => $report->layout,
            'created_at' => $report->created_at?->toIso8601String(),
        ];
    }

    private static function date(Request $request, string $key): ?string
    {
        $value = $request->input($key);

        return is_string($value) && $value !== '' ? $value : null;
    }

    private static function iso(mixed $value): ?string
    {
        return is_string($value) ? CarbonImmutable::parse($value)->toIso8601String() : null;
    }
}
