<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Billing\Entitlements;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreProjectRequest;
use App\Http\Requests\UpdateProjectRequest;
use App\Http\Resources\ProjectResource;
use App\Models\Project;
use App\Support\Audit\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Projetos da agência do contexto. Não há filtro manual por tenant aqui de propósito:
 * o isolamento vem do RLS no banco e do TenantScope no model.
 */
final class ProjectController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        return ProjectResource::collection(
            Project::query()->orderBy('name')->get(),
        );
    }

    public function store(StoreProjectRequest $request, Audit $audit): JsonResponse
    {
        app(Entitlements::class)->ensure('projects');
        $project = Project::query()->create($request->validated());

        $audit->record('project.created', $project, ['name' => $project->name]);

        return (new ProjectResource($project))->response()->setStatusCode(201);
    }

    public function show(Project $project): ProjectResource
    {
        return new ProjectResource($project);
    }

    public function update(UpdateProjectRequest $request, Project $project, Audit $audit): ProjectResource
    {
        /** @var array<string, mixed> $basics */
        $basics = $request->safe()->only(['name', 'niche']);
        $project->fill($basics);

        if ($request->has('goals')) {
            /** @var array<string, mixed> $goals */
            $goals = $request->validated('goals');
            $settings = is_array($project->settings) ? $project->settings : [];
            foreach (['gross_margin_pct', 'target_cpa', 'target_roas'] as $key) {
                if (array_key_exists($key, $goals)) {
                    $settings[$key] = is_numeric($goals[$key]) ? (float) $goals[$key] : null;
                }
            }
            $project->settings = $settings;
        }

        $project->save();
        $audit->record('project.updated', $project, $request->validated());

        return new ProjectResource($project);
    }
}
