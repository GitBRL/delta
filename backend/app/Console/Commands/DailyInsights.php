<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Actions\ActionPlan;
use App\Domain\Goals\GoalProgress;
use App\Domain\Insights\AttentionEvaluator;
use App\Domain\Insights\HealthScore;
use App\Domain\Integrations\ConnectionManager;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Models\Action;
use App\Models\Goal;
use App\Models\Project;
use App\Support\Tenancy\TenantContext;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Rotina diária de inteligência, de todas as agências (ids via funções estreitas; o resto sob RLS):
 *  - nota de saúde de cada projeto (histórico para a tendência);
 *  - medição de impacto das ações aplicadas há 14 dias.
 */
#[Signature('insights:daily')]
#[Description('Calcula a saúde dos projetos e mede o impacto das ações aplicadas')]
final class DailyInsights extends Command
{
    public function handle(TenantContext $context, AttentionEvaluator $attention, GoalProgress $progress, Catalog $catalog, ActionPlan $plan): int
    {
        $end = ConnectionManager::yesterday();
        $scores = 0;

        foreach (DB::select('select tenant_id from app.tenants_with_projects()') as $row) {
            if (! is_object($row) || ! is_string($row->tenant_id ?? null)) {
                continue;
            }

            $scores += $context->run($row->tenant_id, null, function () use ($attention, $progress, $catalog, $end): int {
                $set = MetricSet::forCurrentTenant($catalog);
                $done = 0;
                foreach (Project::query()->get() as $project) {
                    if (! $project->accounts()->exists()) {
                        continue;
                    }
                    $evaluation = $attention->evaluate($project, $end->subDays(6), $end);
                    $goals = Goal::query()->where('project_id', $project->id)->where('active', true)->get()
                        ->map(fn (Goal $g): string => $progress->compute($g, $project, $set)['status'])->all();
                    $goals = array_values($goals);
                    $health = HealthScore::compute($evaluation, $goals);

                    DB::table('health_scores_daily')->upsert([[
                        'tenant_id' => $project->tenant_id, 'project_id' => $project->id, 'date' => $end->addDay()->toDateString(),
                        'score' => $health['score'], 'critical' => $evaluation['summary']['critical'],
                        'attention' => $evaluation['summary']['attention'], 'opportunity' => $evaluation['summary']['opportunity'],
                    ]], ['project_id', 'date'], ['score', 'critical', 'attention', 'opportunity']);
                    $done++;
                }

                return $done;
            });
        }

        $measured = 0;
        foreach (DB::select('select * from app.actions_to_measure(?)', [now()->subDays(ActionPlan::WINDOW_DAYS)]) as $row) {
            if (is_object($row) && is_string($row->tenant_id ?? null) && is_string($row->action_id ?? null)) {
                $measured += (int) $context->run($row->tenant_id, null, fn (): bool => ($a = Action::query()->find($row->action_id)) !== null && $plan->measure($a));
            }
        }

        $this->info("{$scores} nota(s) de saúde; {$measured} ação(ões) medida(s).");

        return self::SUCCESS;
    }
}
