<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Goals\GoalProgress;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Http\Controllers\Controller;
use App\Models\Goal;
use App\Models\Project;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Metas por projeto e o painel "Controle" da agência (todas as metas com progresso). ADR 0017. */
final class GoalController extends Controller
{
    private const SEVERITY = ['off_track' => 0, 'at_risk' => 1, 'no_data' => 2, 'on_track' => 3, 'achieved' => 4];

    public function __construct(
        private readonly GoalProgress $progress,
        private readonly Catalog $catalog,
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    /** Todas as metas da agência (o cliente vê só as dos projetos dele), da mais urgente para a menos. */
    public function index(): JsonResponse
    {
        $set = MetricSet::forCurrentTenant($this->catalog);
        $items = [];
        foreach (Goal::query()->with('project:id,name')->where('active', true)->get() as $goal) {
            if ($goal->project !== null) {
                $items[] = $this->present($goal, $set);
            }
        }
        usort($items, fn (array $a, array $b): int => [self::SEVERITY[$a['progress']['status']] ?? 9, $a['project']['name']]
            <=> [self::SEVERITY[$b['progress']['status']] ?? 9, $b['project']['name']]);

        return response()->json(['data' => $items]);
    }

    public function forProject(Project $project): JsonResponse
    {
        $set = MetricSet::forCurrentTenant($this->catalog);

        return response()->json(['data' => Goal::query()->with('project:id,name')->where('project_id', $project->id)->orderBy('created_at')->get()
            ->map(fn (Goal $g): array => $this->present($g, $set))->values()->all()]);
    }

    public function store(Request $request, Project $project): JsonResponse
    {
        $set = MetricSet::forCurrentTenant($this->catalog);
        $goal = Goal::query()->create([...$this->validated($request, $set), 'project_id' => $project->id, 'created_by' => $this->context->userId()]);
        $this->audit->record('goal.created', $goal, ['metric' => $goal->metric_key]);

        return response()->json(['data' => $this->present($goal->load('project:id,name'), $set)], 201);
    }

    public function update(Request $request, Goal $goal): JsonResponse
    {
        $set = MetricSet::forCurrentTenant($this->catalog);
        $goal->fill([...$this->validated($request, $set), 'last_status' => null])->save();

        return response()->json(['data' => $this->present($goal->load('project:id,name'), $set)]);
    }

    public function destroy(Goal $goal): Response
    {
        $this->audit->record('goal.deleted', $goal, ['metric' => $goal->metric_key]);
        $goal->delete();

        return response()->noContent();
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, MetricSet $set): array
    {
        $request->validate([
            'metric_key' => ['required', 'string', 'max:120'],
            'comparison' => ['required', Rule::in(['at_least', 'at_most'])],
            'target' => ['required', 'numeric', 'gt:0', 'lt:1000000000000'],
            'period' => ['required', Rule::in(['month', 'week'])],
            'active' => ['boolean'],
        ], ['target.gt' => 'A meta precisa ser maior que zero.', 'comparison.in' => 'Escolha "pelo menos" ou "no máximo".']);

        $key = $request->string('metric_key')->toString();
        if (! $set->has($key)) {
            throw ValidationException::withMessages(['metric_key' => 'Métrica desconhecida.']);
        }

        return [
            'metric_key' => $key,
            'comparison' => $request->string('comparison')->toString(),
            'target' => $request->float('target'),
            'period' => $request->string('period')->toString(),
            'active' => $request->boolean('active', true),
        ];
    }

    /** @return array{id: string, project: array{id: string, name: string}, metric_key: string, comparison: string, target: float, period: string, active: bool, progress: array{status: string}&array<string, mixed>} */
    private function present(Goal $goal, MetricSet $set): array
    {
        $project = $goal->project ?? Project::query()->findOrFail($goal->project_id);

        return [
            'id' => $goal->id,
            'project' => ['id' => $project->id, 'name' => $project->name],
            'metric_key' => $goal->metric_key,
            'comparison' => $goal->comparison,
            'target' => (float) $goal->target,
            'period' => $goal->period,
            'active' => $goal->active,
            'progress' => $this->progress->compute($goal, $project, $set),
        ];
    }
}
