<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateProjectAccountsRequest;
use App\Http\Resources\AccountResource;
use App\Models\Project;
use App\Support\Audit\Audit;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/** Quais contas de plataforma alimentam os relatórios de um projeto. */
final class ProjectAccountController extends Controller
{
    public function index(Project $project): AnonymousResourceCollection
    {
        return AccountResource::collection($project->accounts()->orderBy('name')->get());
    }

    public function update(UpdateProjectAccountsRequest $request, Project $project, Audit $audit): AnonymousResourceCollection
    {
        /** @var list<string> $ids */
        $ids = $request->validated('account_ids');
        $changes = $project->accounts()->sync($ids);

        $audit->record('project.accounts_updated', $project, $changes);

        return AccountResource::collection($project->accounts()->orderBy('name')->get());
    }
}
