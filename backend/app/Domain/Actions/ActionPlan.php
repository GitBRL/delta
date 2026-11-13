<?php

declare(strict_types=1);

namespace App\Domain\Actions;

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricDirection;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Query\Comparison;
use App\Domain\Metrics\Query\MetricQuery;
use App\Domain\Metrics\Query\MetricQueryService;
use App\Domain\Reports\Pdf\MetricFormat;
use App\Domain\Timeline\Timeline;
use App\Domain\Webhooks\Webhooks;
use App\Models\Action;
use App\Models\Project;
use Carbon\CarbonImmutable;

/**
 * Plano de ação com medição de impacto (§7.4): ao marcar "aplicada", guarda a linha de base
 * (14 dias antes); 14 dias depois, mede de novo e registra se a métrica melhorou.
 */
final readonly class ActionPlan
{
    public const WINDOW_DAYS = 14;

    public function __construct(
        private MetricQueryService $query,
        private Catalog $catalog,
        private Timeline $timeline,
    ) {}

    public function markDone(Action $action): void
    {
        $applied = CarbonImmutable::now(ConnectionManager::timezone())->startOfDay();
        $start = $applied->subDays(self::WINDOW_DAYS);
        $end = $applied->subDay();

        $action->forceFill([
            'status' => 'done',
            'applied_at' => now(),
            'baseline' => ['value' => $this->value($action, $start, $end), 'start' => $start->toDateString(), 'end' => $end->toDateString()],
            'outcome' => null,
            'measured_at' => null,
        ])->save();

        $this->timeline->record($action->project_id, 'action_applied', "Ação aplicada: {$action->title}", $action->suggestion, metadata: ['action_id' => $action->id]);
    }

    /** Mede o impacto (só depois de completar a janela). Devolve false se ainda não dá. */
    public function measure(Action $action): bool
    {
        $baseline = $action->baseline;
        if ($action->applied_at === null || $baseline === null) {
            return false;
        }

        $start = CarbonImmutable::parse($action->applied_at)->setTimezone(ConnectionManager::timezone())->startOfDay();
        $end = $start->addDays(self::WINDOW_DAYS - 1);
        if ($end->gt(ConnectionManager::yesterday())) {
            return false;
        }

        $after = $this->value($action, $start, $end);
        $before = $baseline['value'];
        $change = $after !== null && $before !== null && $before != 0.0 ? round(($after - $before) / abs($before) * 100, 1) : null;
        $spec = MetricSet::forCurrentTenant($this->catalog)->metric($action->metric_key);
        $improved = $change === null || $spec === null || $spec->direction === MetricDirection::Neutral
            ? null
            : ($spec->direction === MetricDirection::LowerIsBetter ? $change < 0 : $change > 0);

        $action->forceFill([
            'outcome' => ['value' => $after, 'start' => $start->toDateString(), 'end' => $end->toDateString(), 'change_pct' => $change, 'improved' => $improved],
            'measured_at' => now(),
        ])->save();

        Webhooks::emit('action.measured', [
            'action_id' => $action->id, 'project_id' => $action->project_id, 'metric_key' => $action->metric_key, 'title' => $action->title,
            'before' => $before, 'after' => $after, 'change_pct' => $change, 'improved' => $improved,
        ]);

        if ($spec !== null && $change !== null) {
            $fmt = fn (?float $v): string => MetricFormat::value($v, $spec->unit->value, $spec->decimals);
            $verb = $change >= 0 ? 'subiu' : 'caiu';
            $this->timeline->record($action->project_id, 'action_result',
                "Resultado: {$spec->label} {$verb} ".MetricFormat::value(abs($change), 'percent', 1)." após \"{$action->title}\"",
                "Antes: {$fmt($before)} ({$baseline['start']} a {$baseline['end']}). Depois: {$fmt($after)} ({$start->toDateString()} a {$end->toDateString()}).",
                metadata: ['action_id' => $action->id, 'improved' => $improved]);
        }

        return true;
    }

    private function value(Action $action, CarbonImmutable $start, CarbonImmutable $end): ?float
    {
        $project = Project::query()->find($action->project_id);
        $set = MetricSet::forCurrentTenant($this->catalog);
        if ($project === null || ! $set->has($action->metric_key)) {
            return null;
        }

        $raw = $this->query->run(new MetricQuery($project, $start, $end, Comparison::None, [$action->metric_key], false, $set))['metrics'][0]['value'] ?? null;

        return is_int($raw) || is_float($raw) ? (float) $raw : null;
    }
}
