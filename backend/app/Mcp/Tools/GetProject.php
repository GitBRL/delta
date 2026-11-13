<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Http\Controllers\Api\ProjectAccountController;
use App\Http\Controllers\Api\ProjectController;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('get_project')]
#[IsReadOnly]
#[Description('Detalhes de um projeto: dados de negócio (nicho, margem, ticket, metas de CPA/ROAS) e as contas conectadas por canal.')]
final class GetProject extends DeltaTool
{
    protected function scope(): string
    {
        return 'projects:read';
    }

    public function handle(Request $request): Response
    {
        $project = $this->project($request) ?? null;
        if ($project === null) {
            return self::projectNotFound();
        }

        return Response::json([
            'project' => self::data(app(ProjectController::class)->show($project)),
            'accounts' => self::data(app(ProjectAccountController::class)->index($project)),
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return ['project_id' => $schema->string()->description('Id do projeto (de list_projects).')->required()];
    }
}
