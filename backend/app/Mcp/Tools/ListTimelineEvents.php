<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Http\Controllers\Api\TimelineController;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Validation\ValidationException;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('list_timeline_events')]
#[IsReadOnly]
#[Description('Linha do tempo do projeto: marcos manuais (campanha nova, mudança de site) e automáticos (meta atingida, ação aplicada e resultado medido). Ajuda a explicar variações nas métricas.')]
final class ListTimelineEvents extends DeltaTool
{
    protected function scope(): string
    {
        return 'projects:read';
    }

    public function handle(Request $request): Response
    {
        $project = $this->project($request);
        if ($project === null) {
            return self::projectNotFound();
        }

        try {
            $response = app(TimelineController::class)->index(
                self::httpRequest(array_filter(['start' => $request->get('start'), 'end' => $request->get('end')], 'is_string')),
                $project,
            );
        } catch (ValidationException) {
            return Response::error('Use datas no formato AAAA-MM-DD.');
        }

        return Response::json(self::data($response));
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->string()->description('Id do projeto (de list_projects).')->required(),
            'start' => $schema->string()->description('A partir de (AAAA-MM-DD). Opcional.'),
            'end' => $schema->string()->description('Até (AAAA-MM-DD). Opcional.'),
        ];
    }
}
