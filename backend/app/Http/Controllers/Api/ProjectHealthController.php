<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Goals\GoalProgress;
use App\Domain\Insights\AttentionEvaluator;
use App\Domain\Insights\HealthScore;
use App\Domain\Integrations\ConnectionManager;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Http\Controllers\Controller;
use App\Models\Goal;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Saúde da conta do projeto: nota atual (últimos 7 dias + metas), fatores e a tendência diária. */
final class ProjectHealthController extends Controller
{
    public function __invoke(Request $request, Project $project, AttentionEvaluator $attention, GoalProgress $progress, Catalog $catalog): JsonResponse
    {
        $request->validate(['days' => ['nullable', 'integer', 'between:7,365']]);
        $end = ConnectionManager::yesterday();
        $set = MetricSet::forCurrentTenant($catalog);

        $evaluation = $attention->evaluate($project, $end->subDays(6), $end);
        $goals = Goal::query()->where('project_id', $project->id)->where('active', true)->get()
            ->map(fn (Goal $g): string => $progress->compute($g, $project, $set)['status'])->all();
        $goals = array_values($goals);

        $history = DB::table('health_scores_daily')->where('project_id', $project->id)
            ->where('date', '>=', $end->subDays($request->integer('days', 90))->toDateString())
            ->orderBy('date')->get(['date', 'score'])
            ->map(fn (object $r): array => ['date' => is_string($r->date ?? null) ? $r->date : '', 'score' => is_numeric($r->score ?? null) ? (int) $r->score : 0])
            ->values()->all();

        return response()->json(['data' => [
            ...HealthScore::compute($evaluation, $goals),
            'summary' => $evaluation['summary'],
            'history' => $history,
        ]]);
    }
}
