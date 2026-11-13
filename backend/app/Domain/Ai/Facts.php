<?php

declare(strict_types=1);

namespace App\Domain\Ai;

use App\Domain\Reports\Pdf\MetricFormat;

/**
 * Fatos enviados ao modelo: só números já calculados e formatados pelo sistema, sem nenhum
 * dado pessoal (nada de nomes de contatos, e-mails, telefones — nem o nome do cliente).
 */
final class Facts
{
    /**
     * @param  array<string, mixed>  $report  dados renderizados de um relatório (ReportRenderer)
     * @return array<string, mixed>
     */
    public static function fromReport(array $report, ?string $niche): array
    {
        $metrics = [];
        $signals = [];
        $compare = ($report['compare'] ?? 'none') !== 'none';

        foreach (is_array($report['sections'] ?? null) ? $report['sections'] : [] as $section) {
            foreach (is_array($section) && is_array($section['blocks'] ?? null) ? $section['blocks'] : [] as $block) {
                if (! is_array($block)) {
                    continue;
                }
                $items = match ($block['type'] ?? null) {
                    'kpis', 'table' => is_array($block['metrics'] ?? null) ? $block['metrics'] : [],
                    'chart' => is_array($block['metric'] ?? null) ? [$block['metric']] : [],
                    default => [],
                };
                foreach ($items as $m) {
                    if (is_array($m) && is_string($m['key'] ?? null) && ! isset($metrics[$m['key']])) {
                        $metrics[$m['key']] = self::metric($m, $compare);
                    }
                }
                if (($block['type'] ?? null) === 'attention') {
                    foreach (is_array($block['signals'] ?? null) ? $block['signals'] : [] as $s) {
                        if (is_array($s)) {
                            $signals[] = ['estado' => $s['status'] ?? null, 'titulo' => $s['title'] ?? null, 'explicacao' => $s['explanation'] ?? null, 'sugestao' => $s['suggestion'] ?? null];
                        }
                    }
                }
            }
        }

        return [
            'nicho' => $niche,
            'periodo' => is_array($report['period'] ?? null) ? ($report['period']['label'] ?? null) : null,
            'comparado_com' => is_string($start = data_get($report, 'comparison.start')) && is_string($end = data_get($report, 'comparison.end'))
                ? MetricFormat::date($start).' – '.MetricFormat::date($end) : null,
            'metricas' => array_values($metrics),
            'pontos_de_atencao' => $signals,
        ];
    }

    /**
     * @param  array<mixed>  $m
     * @return array<string, mixed>
     */
    private static function metric(array $m, bool $compare): array
    {
        $unit = is_string($m['unit'] ?? null) ? $m['unit'] : 'count';
        $decimals = is_int($m['decimals'] ?? null) ? $m['decimals'] : null;

        return array_filter([
            'metrica' => $m['label'] ?? null,
            'canal' => $m['provider_name'] ?? null,
            'valor' => MetricFormat::value($m['value'] ?? null, $unit, $decimals),
            'anterior' => $compare ? MetricFormat::value($m['previous'] ?? null, $unit, $decimals) : null,
            'variacao' => $compare ? (MetricFormat::change($m['change_pct'] ?? null) ?: null) : null,
            'tendencia' => $compare && is_string($m['sentiment'] ?? null) ? (['positive' => 'melhorou', 'negative' => 'piorou', 'neutral' => 'estável'][$m['sentiment']] ?? null) : null,
            'semaforo' => $m['status'] ?? null,
        ], fn (mixed $v): bool => $v !== null);
    }
}
