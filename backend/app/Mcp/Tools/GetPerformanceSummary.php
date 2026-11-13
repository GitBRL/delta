<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Domain\Goals\GoalProgress;
use App\Domain\Insights\AttentionEvaluator;
use App\Domain\Integrations\ConnectionManager;
use App\Domain\Metrics\Catalog\Catalog;
use App\Http\Controllers\Api\ProjectHealthController;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('get_performance_summary')]
#[IsReadOnly]
#[Description('Diagnóstico do projeto: saúde da conta (0–100) com os fatores, e os sinais de atenção dos últimos 7 dias (regras de boas práticas, referências do nicho e histórico do próprio cliente), cada um com explicação e sugestão.')]
final class GetPerformanceSummary extends DeltaTool
{
    protected function scope(): string
    {
        return 'metrics:read';
    }

    public function handle(Request $request, AttentionEvaluator $attention, GoalProgress $progress, Catalog $catalog): Response
    {
        $project = $this->project($request);
        if ($project === null) {
            return self::projectNotFound();
        }

        $health = self::data(app(ProjectHealthController::class)(self::httpRequest(['days' => 30]), $project, $attention, $progress, $catalog));
        $end = ConnectionManager::yesterday();
        $evaluation = $attention->evaluate($project, $end->subDays(6), $end);

        return Response::json([
            'health' => $health,
            'signals' => $evaluation['signals'],
            'period' => $evaluation['period'],
        ]);
    }

    public function schema(JsonSchema $schema): array
    {
        return ['project_id' => $schema->string()->description('Id do projeto (de list_projects).')->required()];
    }
}
