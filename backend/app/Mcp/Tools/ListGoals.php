<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Http\Controllers\Api\GoalController;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('list_goals')]
#[IsReadOnly]
#[Description('Metas com o progresso: valor atual, ritmo, projeção para o fim do período e situação (no ritmo, em risco, atingida). Sem project_id, lista as metas ativas da agência, das mais críticas para as demais.')]
final class ListGoals extends DeltaTool
{
    protected function scope(): string
    {
        return 'projects:read';
    }

    public function handle(Request $request): Response
    {
        $controller = app(GoalController::class);
        if ($request->get('project_id') === null) {
            return Response::json(self::data($controller->index()));
        }

        $project = $this->project($request);

        return $project === null ? self::projectNotFound() : Response::json(self::data($controller->forProject($project)));
    }

    public function schema(JsonSchema $schema): array
    {
        return ['project_id' => $schema->string()->description('Id do projeto. Opcional.')];
    }
}
