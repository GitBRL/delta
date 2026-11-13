<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Http\Controllers\Api\ReportSnapshotController;
use App\Models\ReportSnapshot;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Str;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('get_report_snapshot')]
#[IsReadOnly]
#[Description('Conteúdo de uma versão publicada de relatório (o que o cliente recebeu): período, blocos de KPIs, gráficos, tabelas, textos e sinais de atenção, com os números congelados na publicação.')]
final class GetReportSnapshot extends DeltaTool
{
    protected function scope(): string
    {
        return 'reports:read';
    }

    public function handle(Request $request): Response
    {
        $id = $request->get('snapshot_id');
        $snapshot = is_string($id) && Str::isUuid($id) ? ReportSnapshot::query()->find($id) : null;
        if ($snapshot === null) {
            return Response::error('Versão de relatório não encontrada. Use list_reports com project_id para ver as versões publicadas.');
        }

        return Response::json(self::data(app(ReportSnapshotController::class)->show($snapshot)));
    }

    public function schema(JsonSchema $schema): array
    {
        return ['snapshot_id' => $schema->string()->description('Id da versão publicada (de list_reports).')->required()];
    }
}
