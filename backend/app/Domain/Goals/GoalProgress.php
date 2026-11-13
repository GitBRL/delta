<?php

declare(strict_types=1);

namespace App\Domain\Goals;

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Metrics\Catalog\MetricKind;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Query\Comparison;
use App\Domain\Metrics\Query\MetricQuery;
use App\Domain\Metrics\Query\MetricQueryService;
use App\Models\Goal;
use App\Models\Project;
use Carbon\CarbonImmutable;

/**
 * Progresso de uma meta no período corrente (dados até ontem; no dia 1, o período que fechou).
 *  - Métricas que acumulam (aditivas: leads, investimento): ritmo esperado e projeção do período.
 *  - Métricas de nível (CPA, ROAS, taxas, seguidores): o valor atual contra a meta.
 * Estado: achieved, on_track, at_risk (até 10% fora), off_track, no_data.
 */
final readonly class GoalProgress
{
    public const TOLERANCE = 0.10;

    public function __construct(private MetricQueryService $query) {}

    /**
     * @return array{goal_id: string, period: array{key: string, label: string, start: string, end: string, closed: bool}, value: float|null,
     *     target: float, expected: float, projection: float|null, progress_pct: float|null, cumulative: bool,
     *     days: array{elapsed: int, total: int}, status: string, label: string, unit: string, decimals: int}
     */
    public function compute(Goal $goal, Project $project, MetricSet $set, ?CarbonImmutable $today = null): array
    {
        $today = ($today ?? CarbonImmutable::now(ConnectionManager::timezone()))->startOfDay();
        [$start, $end, $closed, $key, $label] = self::period($goal->period, $today);
        $dataEnd = $closed ? $end : $today->subDay();

        $spec = $set->metric($goal->metric_key);
        $value = null;
        if ($spec !== null && $dataEnd->gte($start)) {
            $result = $this->query->run(new MetricQuery($project, $start, $dataEnd, Comparison::None, [$goal->metric_key], false, $set));
            $raw = $result['metrics'][0]['value'] ?? null;
            $value = is_int($raw) || is_float($raw) ? (float) $raw : null;
        }

        $target = (float) $goal->target;
        $cumulative = $spec !== null && $spec->kind === MetricKind::Additive;
        $total = (int) $start->diffInDays($end) + 1;
        $elapsed = $closed ? $total : max(0, (int) $start->diffInDays($dataEnd) + 1);
        $projection = $value !== null && $cumulative && $elapsed > 0 ? $value / $elapsed * $total : $value;
        $expected = $cumulative ? $target * $elapsed / $total : $target;

        return [
            'goal_id' => $goal->id,
            'period' => ['key' => $key, 'label' => $label, 'start' => $start->toDateString(), 'end' => $end->toDateString(), 'closed' => $closed],
            'value' => $value === null ? null : round($value, 4),
            'target' => $target,
            'expected' => round($expected, 4),
            'projection' => $projection === null ? null : round($projection, 4),
            'progress_pct' => $value === null || $target == 0.0 ? null : round(($goal->comparison === 'at_least' ? $value / $target : $target / max($value, 1e-9)) * 100, 1),
            'cumulative' => $cumulative,
            'days' => ['elapsed' => $elapsed, 'total' => $total],
            'status' => self::status($goal->comparison, $value, $projection, $target, $closed, $cumulative),
            'label' => $spec !== null ? $spec->label : $goal->metric_key,
            'unit' => $spec !== null ? $spec->unit->value : 'count',
            'decimals' => $spec !== null ? $spec->decimals : 0,
        ];
    }

    private static function status(string $comparison, ?float $value, ?float $projection, float $target, bool $closed, bool $cumulative): string
    {
        if ($value === null) {
            return 'no_data';
        }

        $atLeast = $comparison === 'at_least';
        $met = $atLeast ? $value >= $target : $value <= $target;

        if ($closed) {
            return $met ? 'achieved' : 'off_track';
        }
        if ($cumulative && $atLeast && $met) {
            return 'achieved'; // já bateu antes de fechar o período
        }

        $basis = $cumulative ? (float) $projection : $value;
        $ok = $atLeast ? $basis >= $target : $basis <= $target;
        $close = $atLeast ? $basis >= $target * (1 - self::TOLERANCE) : $basis <= $target * (1 + self::TOLERANCE);

        return $ok ? 'on_track' : ($close ? 'at_risk' : 'off_track');
    }

    /** @return array{0: CarbonImmutable, 1: CarbonImmutable, 2: bool, 3: string, 4: string} */
    private static function period(string $period, CarbonImmutable $today): array
    {
        $months = [1 => 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

        if ($period === 'week') {
            $closed = $today->dayOfWeekIso === 1; // segunda: avalia a semana que fechou
            $start = ($closed ? $today->subWeek() : $today)->startOfWeek(CarbonImmutable::MONDAY);
            $end = $start->addDays(6);

            return [$start, $end, $closed, $start->format('o-\WW'), 'semana de '.$start->format('d/m')];
        }

        $closed = $today->day === 1;
        $start = ($closed ? $today->subMonthNoOverflow() : $today)->startOfMonth();
        $end = $start->endOfMonth()->startOfDay();

        return [$start, $end, $closed, $start->format('Y-m'), $months[$start->month].' de '.$start->year];
    }
}
