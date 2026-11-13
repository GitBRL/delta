<?php

declare(strict_types=1);

namespace App\Domain\Insights;

use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Query\Comparison;
use App\Domain\Metrics\Query\MetricQuery;
use App\Domain\Metrics\Query\MetricQueryService;
use App\Domain\Reports\ReportPeriod;
use App\Models\Project;

/**
 * Visão geral da agência: KPIs de mídia combinados (Meta Ads + Google Ads), anéis de saúde por
 * etapa do funil, Radar com os sinais mais urgentes e o estado de cada projeto.
 * Os projetos vêm sob RLS: o papel cliente só vê os dele.
 *
 * Combinação: soma de investimento, conversões e receita; CPA e ROAS pela razão das somas.
 * (Uma conta ligada a dois projetos entra duas vezes — caso raro, avisado na tela.)
 */
final readonly class Overview
{
    private const MEDIA = [
        'spend' => ['meta_ads:spend', 'google_ads:cost'],
        'conversions' => ['meta_ads:conversions', 'google_ads:conversions'],
        'conversion_value' => ['meta_ads:conversion_value', 'google_ads:conversion_value'],
    ];

    /** Etapa do funil de cada métrica avaliada pelo semáforo. */
    private const STAGES = [
        'acquisition' => ['reach', 'impressions', 'cpm', 'frequency', 'ctr', 'cpc', 'avg_cpc', 'link_clicks', 'clicks', 'search_impression_share', 'sessions', 'new_users', 'followers', 'follows', 'views'],
        'engagement' => ['engagement_rate', 'interactions', 'engagements', 'engaged_sessions', 'avg_engagement_time', 'posts'],
        'conversion' => ['conversions', 'conversion_rate', 'cpa', 'roas', 'cpl', 'leads', 'key_events', 'session_conversion_rate', 'purchase_revenue', 'conversion_value'],
    ];

    private const SCORE = ['healthy' => 100, 'opportunity' => 85, 'attention' => 50, 'critical' => 10];

    private const SEVERITY = ['critical' => 3, 'attention' => 2, 'opportunity' => 1, 'healthy' => 0, 'no_data' => -1];

    public function __construct(
        private MetricQueryService $query,
        private AttentionEvaluator $attention,
        private Catalog $catalog,
    ) {}

    /** @return array<string, mixed> */
    public function build(ReportPeriod $period, Comparison $compare): array
    {
        $set = MetricSet::forCurrentTenant($this->catalog);
        $keys = array_merge(...array_values(self::MEDIA));
        $totals = ['current' => array_fill_keys(array_keys(self::MEDIA), null), 'previous' => array_fill_keys(array_keys(self::MEDIA), null)];
        $stageScores = array_fill_keys(array_keys(self::STAGES), []);
        $projects = [];
        $radar = [];

        foreach (Project::query()->orderBy('name')->get() as $project) {
            $providers = $project->accounts()->pluck('provider')->unique()->values()->all();

            if ($providers === []) {
                $projects[] = [...self::projectRow($project, 'no_data', ['critical' => 0, 'attention' => 0, 'opportunity' => 0], null, [], null), 'health' => null];

                continue;
            }

            $values = $this->query->run(new MetricQuery($project, $period->start, $period->end, $compare, $keys, false, $set));
            $byKey = [];
            foreach ($values['metrics'] as $metric) {
                if (is_string($metric['key'] ?? null)) {
                    $byKey[$metric['key']] = $metric;
                }
            }
            foreach (self::MEDIA as $name => $metricKeys) {
                foreach ($metricKeys as $key) {
                    $totals['current'][$name] = self::add($totals['current'][$name], $byKey[$key]['value'] ?? null);
                    $totals['previous'][$name] = self::add($totals['previous'][$name], $byKey[$key]['previous'] ?? null);
                }
            }

            $evaluation = $this->attention->evaluate($project, $period->start, $period->end);
            foreach ($evaluation['statuses'] as $metric => $status) {
                $stage = self::stage($metric);
                if ($stage !== null && isset(self::SCORE[$status])) {
                    $stageScores[$stage][] = self::SCORE[$status];
                }
            }

            $signals = $evaluation['signals'];
            $top = $signals[0] ?? null;
            $status = $top !== null && is_string($top['status'] ?? null) ? $top['status'] : 'healthy';
            $spend = self::add($byKey['meta_ads:spend']['value'] ?? null, $byKey['google_ads:cost']['value'] ?? null);
            $projects[] = [...self::projectRow($project, $status, $evaluation['summary'], $top, array_values(array_filter($providers, 'is_string')), $spend), 'health' => HealthScore::compute($evaluation)['score']];

            foreach (array_slice($signals, 0, 3) as $signal) {
                $radar[] = ['project_id' => $project->id, 'project' => $project->name, ...$signal];
            }
        }

        usort($radar, fn (array $a, array $b): int => self::severity($b['status'] ?? null) <=> self::severity($a['status'] ?? null));
        usort($projects, fn (array $a, array $b): int => [self::severity($b['status']), $a['name']] <=> [self::severity($a['status']), $b['name']]);

        return [
            'period' => ['start' => $period->start->toDateString(), 'end' => $period->end->toDateString(), 'label' => $period->label()],
            'compare' => $compare->value,
            'kpis' => $this->kpis($totals['current'], $compare === Comparison::None ? null : $totals['previous']),
            'health' => array_map(fn (array $scores): ?int => $scores === [] ? null : (int) round(array_sum($scores) / count($scores)), $stageScores),
            'radar' => array_slice($radar, 0, 12),
            'projects' => $projects,
            'counts' => [
                'projects' => count($projects),
                'with_data' => count(array_filter($projects, fn (array $p): bool => $p['status'] !== 'no_data')),
                'critical' => count(array_filter($projects, fn (array $p): bool => $p['status'] === 'critical')),
                'attention' => count(array_filter($projects, fn (array $p): bool => $p['status'] === 'attention')),
                'opportunity' => count(array_filter($projects, fn (array $p): bool => $p['status'] === 'opportunity')),
            ],
        ];
    }

    /**
     * @param  array<string, float|null>  $now
     * @param  array<string, float|null>|null  $before
     * @return list<array<string, mixed>>
     */
    private function kpis(array $now, ?array $before): array
    {
        $ratio = fn (?float $a, ?float $b): ?float => $a !== null && $b !== null && $b > 0 ? $a / $b : null;
        $current = [
            'spend' => $now['spend'], 'conversions' => $now['conversions'],
            'cpa' => $ratio($now['spend'], $now['conversions']), 'roas' => $ratio($now['conversion_value'], $now['spend']),
        ];
        $previous = $before === null ? null : [
            'spend' => $before['spend'], 'conversions' => $before['conversions'],
            'cpa' => $ratio($before['spend'], $before['conversions']), 'roas' => $ratio($before['conversion_value'], $before['spend']),
        ];
        $meta = [
            'spend' => ['Investimento em mídia', 'currency', 'neutral', 2],
            'conversions' => ['Conversões', 'count', 'higher_is_better', 0],
            'cpa' => ['Custo por conversão', 'currency', 'lower_is_better', 2],
            'roas' => ['ROAS combinado', 'decimal', 'higher_is_better', 2],
        ];

        $out = [];
        foreach ($meta as $key => [$label, $unit, $direction, $decimals]) {
            $value = $current[$key];
            $prev = $previous[$key] ?? null;
            $change = $value !== null && $prev !== null && $prev != 0.0 ? round(($value - $prev) / abs($prev) * 100, 1) : null;
            $out[] = [
                'key' => $key, 'label' => $label, 'unit' => $unit, 'direction' => $direction, 'decimals' => $decimals,
                'value' => $value === null ? null : round($value, 4), 'previous' => $prev === null ? null : round($prev, 4), 'change_pct' => $change,
                'sentiment' => match (true) {
                    $change === null || $direction === 'neutral' || abs($change) < 1 => 'neutral',
                    ($change > 0) === ($direction === 'higher_is_better') => 'positive',
                    default => 'negative',
                },
            ];
        }

        return $out;
    }

    /**
     * @param  array<string, int>  $summary
     * @param  array<string, mixed>|null  $top
     * @param  list<string>  $providers
     * @return array<string, mixed>
     */
    private static function projectRow(Project $project, string $status, array $summary, ?array $top, array $providers, ?float $spend): array
    {
        return [
            'id' => $project->id,
            'name' => $project->name,
            'niche' => $project->niche,
            'status' => $status,
            'summary' => $summary,
            'headline' => $top === null ? ($status === 'no_data' ? 'Nenhuma conta conectada ao projeto' : 'Todos os indicadores dentro do esperado') : $top['title'],
            'detail' => $top === null ? ($status === 'no_data' ? 'Conecte as contas em Integrações e vincule ao projeto.' : 'Nenhuma ação necessária agora.') : $top['suggestion'],
            'providers' => $providers,
            'spend' => $spend === null ? null : round($spend, 2),
        ];
    }

    private static function severity(mixed $status): int
    {
        return is_string($status) ? (self::SEVERITY[$status] ?? 0) : 0;
    }

    private static function stage(string $metric): ?string
    {
        $suffix = explode(':', $metric)[1] ?? $metric;
        foreach (self::STAGES as $stage => $suffixes) {
            if (in_array($suffix, $suffixes, true)) {
                return $stage;
            }
        }

        return null;
    }

    private static function add(mixed $a, mixed $b): ?float
    {
        $a = is_int($a) || is_float($a) ? (float) $a : null;
        $b = is_int($b) || is_float($b) ? (float) $b : null;

        return $a === null && $b === null ? null : ($a ?? 0.0) + ($b ?? 0.0);
    }
}
