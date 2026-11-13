<?php

declare(strict_types=1);

namespace App\Domain\Reports\Pdf;

/**
 * Formatação pt-BR igual à do design system (projects/design-system/.../metric-format.ts),
 * para o PDF mostrar exatamente os mesmos números da tela.
 */
final class MetricFormat
{
    public static function value(mixed $value, string $unit, ?int $decimals = null): string
    {
        if (! is_int($value) && ! is_float($value)) {
            return '—';
        }

        $v = (float) $value;

        return match ($unit) {
            'currency' => abs($v) >= 1_000_000 ? 'R$ '.self::compact($v) : 'R$ '.self::number($v, $decimals ?? 2),
            'percent' => self::number($v, $decimals ?? 1).'%',
            'decimal' => self::number($v, $decimals ?? 2),
            'duration' => self::duration($v),
            default => abs($v) >= 10_000 ? self::compact($v) : self::number($v, 0),
        };
    }

    /** "▲ 12,5%", "▼ 6,0%", "= 0,0%" ou "" sem comparação. */
    public static function change(mixed $pct): string
    {
        if (! is_int($pct) && ! is_float($pct)) {
            return '';
        }

        $arrow = $pct > 0 ? '▲' : ($pct < 0 ? '▼' : '=');

        return $arrow.' '.self::number(abs((float) $pct), 1).'%';
    }

    public static function date(string $iso): string
    {
        $parts = explode('-', $iso);

        return count($parts) === 3 ? "{$parts[2]}/{$parts[1]}/{$parts[0]}" : $iso;
    }

    private static function number(float $value, int $decimals): string
    {
        return number_format($value, $decimals, ',', '.');
    }

    private static function compact(float $value): string
    {
        $abs = abs($value);
        [$div, $suffix] = match (true) {
            $abs >= 1_000_000_000 => [1_000_000_000, ' bi'],
            $abs >= 1_000_000 => [1_000_000, ' mi'],
            default => [1_000, ' mil'],
        };

        $n = $value / $div;
        $text = number_format($n, 1, ',', '.');

        return (str_ends_with($text, ',0') ? substr($text, 0, -2) : $text).$suffix;
    }

    private static function duration(float $seconds): string
    {
        $s = (int) round($seconds);
        if ($s < 60) {
            return "{$s} s";
        }
        if ($s < 3600) {
            return intdiv($s, 60).' min '.str_pad((string) ($s % 60), 2, '0', STR_PAD_LEFT).' s';
        }

        return intdiv($s, 3600).' h '.str_pad((string) intdiv($s % 3600, 60), 2, '0', STR_PAD_LEFT).' min';
    }
}
