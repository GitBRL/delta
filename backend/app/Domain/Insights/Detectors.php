<?php

declare(strict_types=1);

namespace App\Domain\Insights;

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Metrics\Catalog\MetricDirection;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Query\Comparison;
use App\Domain\Metrics\Query\MetricQuery;
use App\Domain\Metrics\Query\MetricQueryService;
use App\Domain\Reports\Pdf\MetricFormat;
use App\Models\Project;
use Carbon\CarbonImmutable;

/**
 * Detectores além das regras de boas práticas (§7.2 do planejamento):
 *  - referência do nicho: métrica fora da faixa p25–p75 do nicho do projeto;
 *  - histórico do cliente: últimos 7 dias fora do normal das 4 semanas anteriores (mediana e
 *    desvio absoluto mediano das semanas — robusto a um pico isolado; semanas inteiras já
 *    neutralizam o efeito do dia da semana);
 *  - qualidade dos dados: conversões zeraram ontem com o tráfego estável (tag quebrada?).
 * Todos com volume mínimo, para não acusar ruído.
 */
final readonly class Detectors
{
    /** Métricas acompanhadas pelo histórico, com o volume mínimo semanal que as torna confiáveis. */
    private const HISTORY = [
        'meta_ads:cpm' => ['meta_ads:impressions', 5000], 'meta_ads:ctr' => ['meta_ads:impressions', 5000],
        'meta_ads:cpa' => ['meta_ads:conversions', 10], 'meta_ads:conversions' => ['meta_ads:spend', 200],
        'google_ads:avg_cpc' => ['google_ads:clicks', 100], 'google_ads:cpa' => ['google_ads:conversions', 10],
        'google_ads:conversions' => ['google_ads:cost', 200],
        'ga4:sessions' => ['ga4:sessions', 300], 'ga4:session_conversion_rate' => ['ga4:sessions', 300],
        'instagram:reach' => ['instagram:reach', 1000],
    ];

    /** Volume mínimo no período para comparar com a referência do nicho. */
    private const BENCHMARK_VOLUME = [
        'meta_ads' => ['meta_ads:impressions', 2000], 'google_ads' => ['google_ads:impressions', 1000],
        'ga4' => ['ga4:sessions', 300], 'instagram' => ['instagram:reach', 1000], 'facebook' => ['facebook:reach', 1000],
    ];

    /** Conversões e o tráfego que as alimenta, por canal (qualidade dos dados). */
    private const TRACKING = [
        'meta_ads:conversions' => 'meta_ads:link_clicks',
        'google_ads:conversions' => 'google_ads:clicks',
        'ga4:key_events' => 'ga4:sessions',
    ];

    public const MIN_DEVIATION = 0.30;

    public function __construct(private MetricQueryService $query) {}

    /**
     * @param  list<string>  $providers
     * @return list<Signal>
     */
    public function detect(Project $project, array $providers, MetricSet $set, CarbonImmutable $start, CarbonImmutable $end): array
    {
        return [
            ...$this->benchmarks($project, $providers, $set, $start, $end),
            ...$this->history($project, $providers, $set),
            ...$this->tracking($project, $providers, $set),
        ];
    }

    /**
     * @param  list<string>  $providers
     * @return list<Signal>
     */
    private function benchmarks(Project $project, array $providers, MetricSet $set, CarbonImmutable $start, CarbonImmutable $end): array
    {
        $metrics = array_values(array_filter(Benchmarks::metrics(), fn (string $k): bool => in_array(explode(':', $k)[0], $providers, true)));
        if ($metrics === []) {
            return [];
        }

        $volumes = array_values(array_unique(array_map(fn (string $p): string => self::BENCHMARK_VOLUME[$p][0] ?? '', $providers)));
        $values = $this->values($project, $set, [...$metrics, ...array_filter($volumes)], $start, $end);
        $signals = [];

        foreach ($metrics as $key) {
            [$volumeKey, $minimum] = self::BENCHMARK_VOLUME[explode(':', $key)[0]];
            $value = $values[$key] ?? null;
            $range = Benchmarks::for($project->niche, $key);
            $spec = $set->metric($key);
            if ($value === null || $range === null || $spec === null || ($values[$volumeKey] ?? 0) < $minimum) {
                continue;
            }

            $worse = $spec->direction === MetricDirection::LowerIsBetter ? $value > $range['p75'] : $value < $range['p25'];
            if (! $worse) {
                continue;
            }

            $fmt = fn (float $v): string => MetricFormat::value($v, $spec->unit->value, $spec->decimals);
            $bound = $spec->direction === MetricDirection::LowerIsBetter ? 'acima de '.$fmt($range['p75']) : 'abaixo de '.$fmt($range['p25']);
            $signals[] = new Signal(
                "benchmark.{$key}",
                $key,
                SignalStatus::Attention,
                "{$spec->label} fora da faixa do nicho",
                "{$spec->label} de {$fmt($value)} no período, {$bound} (faixa típica do nicho: {$fmt($range['p25'])} a {$fmt($range['p75'])}).",
                self::benchmarkTip($key),
                ['value' => round($value, 4), 'p25' => $range['p25'], 'p50' => $range['p50'], 'p75' => $range['p75']],
            );
        }

        return $signals;
    }

    /**
     * @param  list<string>  $providers
     * @return list<Signal>
     */
    private function history(Project $project, array $providers, MetricSet $set): array
    {
        $tracked = array_filter(self::HISTORY, fn (string $k): bool => in_array(explode(':', $k)[0], $providers, true), ARRAY_FILTER_USE_KEY);
        if ($tracked === []) {
            return [];
        }

        $keys = array_values(array_unique([...array_keys($tracked), ...array_column($tracked, 0)]));
        $end = ConnectionManager::yesterday();
        $weeks = [];
        for ($w = 0; $w < 5; $w++) { // 0 = últimos 7 dias; 1–4 = as quatro semanas anteriores
            $to = $end->subDays(7 * $w);
            $weeks[$w] = $this->values($project, $set, $keys, $to->subDays(6), $to);
        }

        $signals = [];
        foreach ($tracked as $key => [$volumeKey, $minimum]) {
            $spec = $set->metric($key);
            $recent = $weeks[0][$key] ?? null;
            $history = array_values(array_filter(array_map(fn (int $w): ?float => ($weeks[$w][$volumeKey] ?? 0) >= $minimum ? ($weeks[$w][$key] ?? null) : null, [1, 2, 3, 4]), fn (?float $v): bool => $v !== null));

            if ($spec === null || $recent === null || ($weeks[0][$volumeKey] ?? 0) < $minimum || count($history) < 3) {
                continue;
            }

            $median = self::median($history);
            if ($median == 0.0) {
                continue;
            }
            $mad = self::median(array_map(fn (float $v): float => abs($v - $median), $history));
            $deviation = ($recent - $median) / abs($median);
            $bad = $spec->direction === MetricDirection::LowerIsBetter ? $deviation > 0 : $deviation < 0;

            if (! $bad || abs($deviation) < self::MIN_DEVIATION || abs($recent - $median) < 3 * $mad) {
                continue;
            }

            $fmt = fn (float $v): string => MetricFormat::value($v, $spec->unit->value, $spec->decimals);
            $pct = MetricFormat::value(abs($deviation) * 100, 'percent', 0);
            $signals[] = new Signal(
                "history.{$key}",
                $key,
                abs($deviation) >= 0.6 ? SignalStatus::Critical : SignalStatus::Attention,
                "{$spec->label} fora do normal deste cliente",
                "{$spec->label} de {$fmt($recent)} nos últimos 7 dias, {$pct} ".($deviation > 0 ? 'acima' : 'abaixo').' do habitual das 4 semanas anteriores ('.$fmt($median).').',
                'Compare com mudanças recentes (campanhas, criativos, orçamento, site) e marque o motivo na linha do tempo do projeto.',
                ['recent' => round($recent, 4), 'median' => round($median, 4), 'deviation_pct' => round($deviation * 100, 1)],
            );
        }

        return $signals;
    }

    /**
     * Conversões zeraram ontem, mas o tráfego seguiu normal: quase sempre é rastreamento.
     *
     * @param  list<string>  $providers
     * @return list<Signal>
     */
    private function tracking(Project $project, array $providers, MetricSet $set): array
    {
        $pairs = array_filter(self::TRACKING, fn (string $k): bool => in_array(explode(':', $k)[0], $providers, true), ARRAY_FILTER_USE_KEY);
        if ($pairs === []) {
            return [];
        }

        $yesterday = ConnectionManager::yesterday();
        $keys = array_values(array_unique([...array_keys($pairs), ...array_values($pairs)]));
        $lastDay = $this->values($project, $set, $keys, $yesterday, $yesterday);
        $week = $this->values($project, $set, $keys, $yesterday->subDays(7), $yesterday->subDay());
        $signals = [];

        foreach ($pairs as $conversions => $traffic) {
            $avgConversions = ($week[$conversions] ?? 0) / 7;
            $avgTraffic = ($week[$traffic] ?? 0) / 7;
            $spec = $set->metric($conversions);

            if ($spec === null || $avgConversions < 3 || ($lastDay[$conversions] ?? null) !== 0.0 || ($lastDay[$traffic] ?? 0) < $avgTraffic * 0.5) {
                continue;
            }

            $signals[] = new Signal(
                "tracking.{$conversions}",
                $conversions,
                SignalStatus::Critical,
                'Conversões zeraram ontem com tráfego normal',
                "{$spec->label}: 0 ontem, contra uma média de ".MetricFormat::value($avgConversions, 'decimal', 1).' por dia na semana anterior — e o tráfego seguiu no patamar normal.',
                'Provável falha de rastreamento: confira o pixel/tag, o Gerenciador de Tags, o consent mode e se a página de obrigado mudou.',
                ['yesterday' => 0, 'daily_average' => round($avgConversions, 2), 'traffic_yesterday' => $lastDay[$traffic] ?? null],
            );
        }

        return $signals;
    }

    /**
     * @param  list<string>  $keys
     * @return array<string, float|null>
     */
    private function values(Project $project, MetricSet $set, array $keys, CarbonImmutable $start, CarbonImmutable $end): array
    {
        $out = [];
        foreach ($this->query->run(new MetricQuery($project, $start, $end, Comparison::None, array_values(array_unique($keys)), false, $set))['metrics'] as $m) {
            if (is_string($m['key'] ?? null)) {
                $out[$m['key']] = is_int($m['value'] ?? null) || is_float($m['value'] ?? null) ? (float) $m['value'] : null;
            }
        }

        return $out;
    }

    /** @param list<float> $values */
    private static function median(array $values): float
    {
        sort($values);
        $n = count($values);

        return $n === 0 ? 0.0 : ($n % 2 === 1 ? $values[intdiv($n, 2)] : ($values[$n / 2 - 1] + $values[$n / 2]) / 2);
    }

    private static function benchmarkTip(string $key): string
    {
        return match (explode(':', $key)[1] ?? '') {
            'ctr' => 'Teste novos ganchos nos primeiros segundos e títulos mais diretos; revise a segmentação do público.',
            'cpc', 'avg_cpc' => 'Melhore a relevância do anúncio (CTR) e revise lances e palavras-chave/públicos caros.',
            'cpm' => 'Amplie o público, evite sobreposição entre conjuntos e confira a sazonalidade do leilão.',
            'conversion_rate', 'session_conversion_rate' => 'Revise a página de destino: velocidade, clareza da oferta, prova social e formulário.',
            'engagement_rate' => 'Priorize formatos e temas com melhor desempenho (Reels, carrosséis) e chamadas para interação.',
            default => 'Compare com os melhores períodos do próprio cliente e ajuste a estratégia.',
        };
    }
}
