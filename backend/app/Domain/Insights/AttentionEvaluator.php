<?php

declare(strict_types=1);

namespace App\Domain\Insights;

use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Query\Comparison;
use App\Domain\Metrics\Query\MetricQuery;
use App\Domain\Metrics\Query\MetricQueryService;
use App\Models\Project;
use Carbon\CarbonImmutable;

/**
 * Semáforo de atenção de um projeto (§7.2 do plano), calculado na hora a partir das métricas.
 *
 * Janelas avaliadas, todas comparadas com o período imediatamente anterior:
 *  - o período escolhido pelo usuário;
 *  - os últimos 7 dias até o fim do período (frequência, ritmo de publicação);
 *  - os últimos 3 dias (qualidade dos dados: conversões que pararam de chegar).
 */
final readonly class AttentionEvaluator
{
    public function __construct(
        private MetricQueryService $queries,
        private Catalog $catalog,
        private Detectors $detectors,
    ) {}

    /**
     * @return array{
     *     period: array{start: string, end: string},
     *     summary: array{critical: int, attention: int, opportunity: int},
     *     statuses: array<string, string>,
     *     signals: list<array<string, mixed>>
     * }
     */
    public function evaluate(Project $project, CarbonImmutable $start, CarbonImmutable $end): array
    {
        $providers = $project->accounts()->pluck('provider')->unique()->values()->all();
        $rules = array_values(array_filter(RuleBook::all(), fn (Rule $rule): bool => in_array($rule->provider(), $providers, true)));

        $signals = [];
        $statuses = [];

        if ($rules !== []) {
            $metrics = array_values(array_unique(array_merge(...array_map(fn (Rule $r): array => $r->metrics(), $rules))));
            $set = MetricSet::forCurrentTenant($this->catalog);

            $windows = [
                RuleContext::PERIOD => $this->window($project, $set, $metrics, $start, $end),
                RuleContext::LAST_7 => $this->window($project, $set, $metrics, $end->subDays(6), $end),
                RuleContext::LAST_3 => $this->window($project, $set, $metrics, $end->subDays(2), $end),
            ];
            $context = new RuleContext($windows, ProjectGoals::of($project), $set);

            foreach ($rules as $rule) {
                $signal = $rule->evaluate($context);
                $primary = $rule->metrics()[0];

                if ($signal !== null) {
                    $signals[] = $signal;
                    $current = isset($statuses[$signal->metric]) ? SignalStatus::from($statuses[$signal->metric]) : SignalStatus::Healthy;
                    if ($signal->status->severity() >= $current->severity()) {
                        $statuses[$signal->metric] = $signal->status->value;
                    }
                } elseif (! isset($statuses[$primary]) && $context->value($primary) !== null) {
                    $statuses[$primary] = SignalStatus::Healthy->value;
                }
            }
        }

        // Referência do nicho, histórico do cliente e qualidade dos dados (§7.2).
        if ($providers !== []) {
            $known = array_map(fn (Signal $s): string => $s->metric.'|'.$s->status->value, $signals);
            foreach ($this->detectors->detect($project, array_values(array_filter($providers, 'is_string')), MetricSet::forCurrentTenant($this->catalog), $start, $end) as $signal) {
                if (in_array($signal->metric.'|'.$signal->status->value, $known, true)) {
                    continue; // a regra de boas práticas já disse o mesmo sobre esta métrica
                }
                $signals[] = $signal;
                $current = isset($statuses[$signal->metric]) ? SignalStatus::from($statuses[$signal->metric]) : SignalStatus::Healthy;
                if ($signal->status->severity() >= $current->severity()) {
                    $statuses[$signal->metric] = $signal->status->value;
                }
            }
        }

        usort($signals, fn (Signal $a, Signal $b): int => $b->status->severity() <=> $a->status->severity());

        $count = fn (SignalStatus $status): int => count(array_filter($signals, fn (Signal $s): bool => $s->status === $status));

        return [
            'period' => ['start' => $start->toDateString(), 'end' => $end->toDateString()],
            'summary' => [
                'critical' => $count(SignalStatus::Critical),
                'attention' => $count(SignalStatus::Attention),
                'opportunity' => $count(SignalStatus::Opportunity),
            ],
            'statuses' => $statuses,
            'signals' => array_map(fn (Signal $s): array => $s->toArray(), $signals),
        ];
    }

    /**
     * @param  list<string>  $metrics
     * @return array<string, array<string, mixed>>
     */
    private function window(Project $project, MetricSet $set, array $metrics, CarbonImmutable $start, CarbonImmutable $end): array
    {
        $result = $this->queries->run(new MetricQuery($project, $start, $end, Comparison::PreviousPeriod, $metrics, set: $set));

        $byKey = [];
        foreach ($result['metrics'] as $item) {
            $key = $item['key'] ?? null;
            if (is_string($key)) {
                $byKey[$key] = $item;
            }
        }

        return $byKey;
    }
}
