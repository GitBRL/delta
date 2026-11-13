<?php

declare(strict_types=1);

namespace App\Domain\Reports\Pdf;

/**
 * Gráfico de área diário em SVG puro (para o PDF, sem JavaScript): período atual preenchido
 * e período de comparação tracejado, na mesma escala.
 */
final class SvgChart
{
    private const W = 720;

    private const H = 200;

    private const PAD = ['top' => 16, 'right' => 8, 'bottom' => 26, 'left' => 8];

    /**
     * @param  list<array{date?: mixed, value?: mixed}>  $series
     * @param  list<array{date?: mixed, value?: mixed}>  $previous
     */
    public static function area(array $series, array $previous, string $unit, ?int $decimals, string $color = '#0a84ff'): string
    {
        $current = self::values($series);
        $before = self::values($previous);
        $all = array_filter([...$current, ...$before], fn (?float $v): bool => $v !== null);

        if ($all === []) {
            return '<p class="empty">Sem dados no período.</p>';
        }

        $max = max($all);
        $min = min(0.0, min($all));
        $span = ($max - $min) ?: 1.0;
        $max += $span * 0.08;
        $span = $max - $min;

        $innerW = self::W - self::PAD['left'] - self::PAD['right'];
        $innerH = self::H - self::PAD['top'] - self::PAD['bottom'];
        $count = max(count($current), count($before), 2);

        $point = function (int $i, float $v) use ($innerW, $innerH, $count, $min, $span): string {
            $x = self::PAD['left'] + $innerW * ($i / ($count - 1));
            $y = self::PAD['top'] + $innerH * (1 - ($v - $min) / $span);

            return round($x, 1).','.round($y, 1);
        };

        $line = function (array $values) use ($point): string {
            $d = '';
            $pen = 'M';
            foreach ($values as $i => $v) {
                if (! is_float($v)) {
                    $pen = 'M';

                    continue;
                }
                $d .= $pen.$point((int) $i, $v).' ';
                $pen = 'L';
            }

            return trim($d);
        };

        $currentPath = $line($current);
        $baseY = round(self::PAD['top'] + $innerH * (1 - (0 - $min) / $span), 1);
        $known = array_keys(array_filter($current, fn (?float $v): bool => $v !== null));
        $area = $known === [] ? '' : $currentPath.' L'.explode(',', $point(max($known), 0))[0].','.$baseY.' L'.explode(',', $point(min($known), 0))[0].','.$baseY.' Z';

        $first = is_string($series[0]['date'] ?? null) ? MetricFormat::date($series[0]['date']) : '';
        $lastItem = $series[count($series) - 1] ?? [];
        $last = is_string($lastItem['date'] ?? null) ? MetricFormat::date($lastItem['date']) : '';
        $top = htmlspecialchars(MetricFormat::value($max, $unit, $decimals));
        $id = 'g'.substr(md5($currentPath), 0, 8);

        $svg = '<svg class="chart" viewBox="0 0 '.self::W.' '.self::H.'" xmlns="http://www.w3.org/2000/svg" role="img">';
        $svg .= '<defs><linearGradient id="'.$id.'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'.$color.'" stop-opacity="0.28"/><stop offset="1" stop-color="'.$color.'" stop-opacity="0.02"/></linearGradient></defs>';
        $svg .= '<line x1="'.self::PAD['left'].'" y1="'.$baseY.'" x2="'.(self::W - self::PAD['right']).'" y2="'.$baseY.'" stroke="#d1d1d6" stroke-width="1"/>';
        if ($before !== [] && array_filter($before, fn (?float $v): bool => $v !== null) !== []) {
            $svg .= '<path d="'.$line($before).'" fill="none" stroke="#8e8e93" stroke-width="1.5" stroke-dasharray="4 4"/>';
        }
        if ($area !== '') {
            $svg .= '<path d="'.$area.'" fill="url(#'.$id.')"/>';
        }
        $svg .= '<path d="'.$currentPath.'" fill="none" stroke="'.$color.'" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
        $svg .= '<text x="'.self::PAD['left'].'" y="11" class="axis">'.$top.'</text>';
        $svg .= '<text x="'.self::PAD['left'].'" y="'.(self::H - 6).'" class="axis">'.htmlspecialchars($first).'</text>';
        $svg .= '<text x="'.(self::W - self::PAD['right']).'" y="'.(self::H - 6).'" class="axis" text-anchor="end">'.htmlspecialchars($last).'</text>';

        return $svg.'</svg>';
    }

    /**
     * @param  list<array{date?: mixed, value?: mixed}>  $series
     * @return list<float|null>
     */
    private static function values(array $series): array
    {
        return array_map(fn (array $p): ?float => is_int($p['value'] ?? null) || is_float($p['value'] ?? null) ? (float) $p['value'] : null, $series);
    }
}
