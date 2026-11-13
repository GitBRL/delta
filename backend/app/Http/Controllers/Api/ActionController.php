<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Actions\ActionPlan;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Http\Controllers\Controller;
use App\Models\Action;
use App\Models\Project;
use App\Models\TenantMembership;
use App\Models\User;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Plano de ação: sugestões do semáforo viram tarefas com responsável, prazo e medição de impacto. */
final class ActionController extends Controller
{
    public function __construct(
        private readonly ActionPlan $plan,
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $query = Action::query()->with('project:id,name')->orderByRaw("CASE status WHEN 'doing' THEN 0 WHEN 'open' THEN 1 WHEN 'done' THEN 2 ELSE 3 END")->orderBy('due_on')->limit(500);
        foreach (['status', 'project_id'] as $filter) {
            if (is_string($value = $request->query($filter)) && $value !== '') {
                $query->where($filter, $value);
            }
        }

        return response()->json(['data' => self::presentAll($query->get())]);
    }

    public function forProject(Project $project): JsonResponse
    {
        return response()->json(['data' => self::presentAll(Action::query()->with('project:id,name')->where('project_id', $project->id)->orderByDesc('created_at')->get())]);
    }

    public function store(Request $request, Project $project, Catalog $catalog): JsonResponse
    {
        $request->validate([
            'rule' => ['nullable', 'string', 'max:120'],
            'metric_key' => ['required', 'string', 'max:120'],
            'title' => ['required', 'string', 'min:2', 'max:160'],
            'suggestion' => ['nullable', 'string', 'max:1000'],
            'assignee_id' => ['nullable', 'uuid'],
            'due_on' => ['nullable', 'date_format:Y-m-d'],
        ], ['title.required' => 'Descreva a ação.']);

        if (! MetricSet::forCurrentTenant($catalog)->has($request->string('metric_key')->toString())) {
            throw ValidationException::withMessages(['metric_key' => 'Métrica desconhecida.']);
        }
        $this->checkAssignee($request);

        $action = Action::query()->create([
            'project_id' => $project->id,
            'rule' => $request->filled('rule') ? $request->string('rule')->toString() : null,
            'metric_key' => $request->string('metric_key')->toString(),
            'title' => $request->string('title')->toString(),
            'status' => 'open',
            'suggestion' => $request->filled('suggestion') ? $request->string('suggestion')->toString() : null,
            'assignee_id' => $request->filled('assignee_id') ? $request->string('assignee_id')->toString() : null,
            'due_on' => $request->filled('due_on') ? $request->string('due_on')->toString() : null,
            'created_by' => $this->context->userId(),
        ]);
        $this->audit->record('action.created', $action, ['rule' => $action->rule]);

        return response()->json(['data' => self::presentAll(collect([$action->load('project:id,name')]))[0]], 201);
    }

    public function update(Request $request, Action $action): JsonResponse
    {
        $request->validate([
            'status' => ['sometimes', Rule::in(['open', 'doing', 'done', 'dismissed'])],
            'title' => ['sometimes', 'string', 'min:2', 'max:160'],
            'assignee_id' => ['sometimes', 'nullable', 'uuid'],
            'due_on' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'dismissed_reason' => ['required_if:status,dismissed', 'nullable', 'string', 'max:300'],
            'feedback' => ['sometimes', 'nullable', Rule::in(['useful', 'not_useful'])],
        ], ['dismissed_reason.required_if' => 'Conte por que a sugestão foi descartada (isso melhora as próximas).']);
        $this->checkAssignee($request);

        $changes = [];
        foreach (['title', 'assignee_id', 'due_on', 'feedback', 'dismissed_reason'] as $field) {
            if ($request->has($field)) {
                $changes[$field] = $request->filled($field) ? $request->string($field)->toString() : null;
            }
        }
        $action->forceFill($changes);

        $status = $request->has('status') ? $request->string('status')->toString() : $action->status;
        if ($status === 'done' && $action->status !== 'done') {
            $action->save();
            $this->plan->markDone($action);
        } else {
            $action->forceFill(['status' => $status])->save();
        }
        $this->audit->record('action.updated', $action, ['status' => $action->status]);

        return response()->json(['data' => self::presentAll(collect([$action->refresh()->load('project:id,name')]))[0]]);
    }

    public function destroy(Action $action): Response
    {
        $action->delete();

        return response()->noContent();
    }

    private function checkAssignee(Request $request): void
    {
        if ($request->filled('assignee_id') && ! TenantMembership::query()->where('tenant_id', $this->context->tenantId())
            ->where('user_id', $request->string('assignee_id')->toString())->where('role', '!=', 'client')->exists()) {
            throw ValidationException::withMessages(['assignee_id' => 'O responsável precisa ser da equipe da agência.']);
        }
    }

    /**
     * @param  Collection<int, Action>  $actions
     * @return list<array<string, mixed>>
     */
    private static function presentAll(Collection $actions): array
    {
        $names = User::query()->whereIn('id', $actions->pluck('assignee_id')->filter()->unique()->values()->all())->pluck('name', 'id');

        return array_values($actions->map(fn (Action $a): array => [
            'id' => $a->id,
            'project' => $a->project === null ? null : ['id' => $a->project->id, 'name' => $a->project->name],
            'rule' => $a->rule,
            'metric_key' => $a->metric_key,
            'title' => $a->title,
            'suggestion' => $a->suggestion,
            'status' => $a->status,
            'assignee' => $a->assignee_id === null ? null : ['id' => $a->assignee_id, 'name' => $names->get($a->assignee_id)],
            'due_on' => $a->due_on?->toDateString(),
            'dismissed_reason' => $a->dismissed_reason,
            'applied_at' => $a->applied_at?->toIso8601String(),
            'baseline' => $a->baseline,
            'outcome' => $a->outcome,
            'measured_at' => $a->measured_at?->toIso8601String(),
            'feedback' => $a->feedback,
            'created_at' => $a->created_at?->toIso8601String(),
        ])->all());
    }
}
