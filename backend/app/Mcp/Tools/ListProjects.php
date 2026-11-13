<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Http\Controllers\Api\ProjectController;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('list_projects')]
#[IsReadOnly]
#[Description('Lista os projetos (clientes) da agência, com id, nome, nicho e metas de negócio. Use o id nas outras ferramentas.')]
final class ListProjects extends DeltaTool
{
    protected function scope(): string
    {
        return 'projects:read';
    }

    public function handle(Request $request): Response
    {
        return Response::json(self::data(app(ProjectController::class)->index()));
    }

    public function schema(JsonSchema $schema): array
    {
        return [];
    }
}
