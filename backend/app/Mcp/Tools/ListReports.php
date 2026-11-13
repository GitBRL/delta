<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\ReportSnapshotController;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('list_reports')]
#[IsReadOnly]
#[Description('Relatórios da agência (ou de um projeto) com a data da última publicação e, com project_id, as versões publicadas (snapshots) para ler com get_report_snapshot.')]
final class ListReports extends DeltaTool
{
    protected function scope(): string
    {
        return 'reports:read';
    }

    public function handle(Request $request): Response
    {
        $projectId = $request->get('project_id');
        $reports = self::data(app(ReportController::class)->index(self::httpRequest(is_string($projectId) ? ['project_id' => $projectId] : [])));
        if ($projectId === null) {
            return Response::json(['reports' => $reports]);
        }

        $project = $this->project($request);

        return $project === null ? self::projectNotFound() : Response::json([
            'reports' => $reports,
            'snapshots' => self::data(app(ReportSnapshotController::class)->forProject($project)),
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return ['project_id' => $schema->string()->description('Id do projeto. Opcional.')];
    }
}
