<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\TimelineEvent;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** Linha do tempo do projeto: marcos manuais (campanha lançada, troca de criativos) e automáticos. */
final class TimelineController extends Controller
{
    public function __construct(private readonly TenantContext $context) {}

    public function index(Request $request, Project $project): JsonResponse
    {
        $request->validate(['start' => ['nullable', 'date_format:Y-m-d'], 'end' => ['nullable', 'date_format:Y-m-d']]);
        $query = TimelineEvent::query()->where('project_id', $project->id)->orderByDesc('occurred_on')->orderByDesc('created_at')->limit(300);
        if ($request->filled('start')) {
            $query->where('occurred_on', '>=', $request->string('start')->toString());
        }
        if ($request->filled('end')) {
            $query->where('occurred_on', '<=', $request->string('end')->toString());
        }

        $events = $query->get();
        $names = User::query()->whereIn('id', $events->pluck('created_by')->filter()->unique()->values()->all())->pluck('name', 'id');

        return response()->json(['data' => $events->map(fn (TimelineEvent $e): array => [
            'id' => $e->id,
            'type' => $e->type,
            'title' => $e->title,
            'description' => $e->description,
            'occurred_on' => $e->occurred_on->toDateString(),
            'metadata' => $e->metadata,
            'created_by' => $e->created_by !== null ? $names->get($e->created_by) : null,
            'manual' => $e->type === 'manual',
        ])->values()->all()]);
    }

    public function store(Request $request, Project $project): JsonResponse
    {
        $request->validate([
            'title' => ['required', 'string', 'min:2', 'max:160'],
            'description' => ['nullable', 'string', 'max:1000'],
            'occurred_on' => ['required', 'date_format:Y-m-d'],
        ], ['title.required' => 'Descreva o marco (ex.: "Campanha de Black Friday no ar").']);

        $event = TimelineEvent::query()->create([
            'project_id' => $project->id,
            'type' => 'manual',
            'title' => $request->string('title')->toString(),
            'description' => $request->filled('description') ? $request->string('description')->toString() : null,
            'occurred_on' => $request->string('occurred_on')->toString(),
            'metadata' => [],
            'created_by' => $this->context->userId(),
        ]);

        return response()->json(['data' => ['id' => $event->id, 'type' => 'manual', 'title' => $event->title, 'description' => $event->description, 'occurred_on' => $event->occurred_on->toDateString(), 'manual' => true]], 201);
    }

    public function destroy(TimelineEvent $event): Response
    {
        abort_if($event->type !== 'manual', 422, 'Marcos automáticos não podem ser removidos.');
        $event->delete();

        return response()->noContent();
    }
}
