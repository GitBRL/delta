<?php

declare(strict_types=1);

namespace App\Domain\Reports;

use App\Domain\Insights\AttentionEvaluator;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Query\Comparison;
use App\Domain\Metrics\Query\MetricQuery;
use App\Domain\Metrics\Query\MetricQueryService;
use App\Models\Project;
use App\Models\Tenant;
use Carbon\CarbonImmutable;

/**
 * Transforma o layout de um relatório nos dados prontos para exibir (prévia no montador,
 * snapshot publicado, PDF e link público usam exatamente o mesmo formato).
 *
 * Uma consulta para todos os valores, outra só para as séries dos gráficos, e o semáforo
 * uma única vez (alimenta o bloco de atenção e os selos dos KPIs).
 */
final readonly class ReportRenderer
{
    public const VERSION = 1;

    public function __construct(
        private MetricQueryService $query,
        private AttentionEvaluator $attention,
        private Catalog $catalog,
    ) {}

    /**
     * @param  array{sections: list<array{id: string, title: string, blocks: list<array<string, mixed>>}>}  $layout
     * @return array<string, mixed>
     */
    public function render(Project $project, string $title, array $layout, ReportPeriod $period, Comparison $compare, MetricSet $set): array
    {
        $keys = ReportLayout::metricKeys($layout);
        $chartKeys = ReportLayout::chartKeys($layout);

        $values = $keys === [] ? null : $this->query->run(new MetricQuery($project, $period->start, $period->end, $compare, $keys, false, $set));
        $series = $chartKeys === [] ? null : $this->query->run(new MetricQuery($project, $period->start, $period->end, $compare, $chartKeys, true, $set));
        $attention = ReportLayout::needsAttention($layout) ? $this->attention->evaluate($project, $period->start, $period->end) : null;

        $byKey = self::index($values['metrics'] ?? []);
        $seriesByKey = self::index($series['metrics'] ?? []);
        $statuses = $attention['statuses'] ?? [];
        $withStatus = fn (string $key): ?array => isset($byKey[$key]) ? [...$byKey[$key], ...$this->origin($key), 'status' => $statuses[$key] ?? null] : null;

        $sections = [];
        foreach ($layout['sections'] as $section) {
            $blocks = [];
            foreach ($section['blocks'] as $block) {
                $base = ['id' => $block['id'], 'type' => $block['type'], 'title' => $block['title'] ?? null];
                $metrics = is_array($block['metrics'] ?? null) ? array_values(array_filter($block['metrics'], 'is_string')) : [];

                $blocks[] = match ($block['type']) {
                    'kpis', 'table' => [...$base,
                        'metrics' => array_values(array_filter(array_map($withStatus, $metrics))),
                        // Bloco com mais de um canal: a tela e o PDF mostram o canal de cada métrica.
                        'mixed' => count(array_unique(array_map(fn (string $k): string => explode(':', $k)[0], $metrics))) > 1,
                    ],
                    'chart' => [...$base, 'metric' => $this->withOrigin($seriesByKey, is_string($block['metric'] ?? null) ? $block['metric'] : '')],
                    'text' => [...$base, 'content' => is_string($block['content'] ?? null) ? $block['content'] : ''],
                    default => [...$base, // attention
                        'summary' => $attention['summary'] ?? ['critical' => 0, 'attention' => 0, 'opportunity' => 0],
                        'signals' => array_slice($attention['signals'] ?? [], 0, is_int($block['limit'] ?? null) ? $block['limit'] : 5),
                    ],
                };
            }

            $sections[] = ['id' => $section['id'], 'title' => $section['title'], 'blocks' => $blocks];
        }

        $comparison = $compare->shift($period->start, $period->end);
        $tenant = Tenant::query()->whereKey($project->tenant_id)->value('name');

        return [
            'version' => self::VERSION,
            'title' => $title,
            'agency' => is_string($tenant) ? $tenant : null,
            'project' => ['id' => $project->id, 'name' => $project->name, 'niche' => $project->niche],
            'period' => ['start' => $period->start->toDateString(), 'end' => $period->end->toDateString(), 'label' => $period->label()],
            'compare' => $compare->value,
            'comparison' => $comparison === null ? null : ['start' => $comparison[0]->toDateString(), 'end' => $comparison[1]->toDateString()],
            'generated_at' => CarbonImmutable::now()->toIso8601String(),
            'sections' => $sections,
        ];
    }

    /** @return array{provider: string, provider_name: string} */
    private function origin(string $key): array
    {
        $provider = explode(':', $key)[0];

        return [
            'provider' => $provider,
            'provider_name' => match ($provider) {
                'custom' => 'Indicador personalizado',
                'manual' => 'Fonte manual',
                default => $this->catalog->provider($provider)?->name() ?? $provider,
            },
        ];
    }

    /**
     * @param  array<string, array<string, mixed>>  $byKey
     * @return array<string, mixed>|null
     */
    private function withOrigin(array $byKey, string $key): ?array
    {
        return isset($byKey[$key]) ? [...$byKey[$key], ...$this->origin($key)] : null;
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private static function index(mixed $metrics): array
    {
        $out = [];
        foreach (is_array($metrics) ? $metrics : [] as $metric) {
            $key = is_array($metric) ? ($metric['key'] ?? null) : null;
            if (is_array($metric) && is_string($key)) {
                /** @var array<string, mixed> $metric */
                $out[$key] = $metric;
            }
        }

        return $out;
    }
}
