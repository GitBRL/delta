<?php

declare(strict_types=1);

namespace App\Domain\Insights;

use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Catalog\MetricUnit;
use NumberFormatter;

/**
 * O que uma regra enxerga: valores do período escolhido (com o período anterior), dos
 * últimos 7 dias e dos últimos 3 dias, mais as metas do projeto.
 */
final readonly class RuleContext
{
    public const PERIOD = 'period';

    public const LAST_7 = 'last7';

    public const LAST_3 = 'last3';

    /** @param array<string, array<string, array<string, mixed>>> $windows janela => (métrica => item da consulta) */
    public function __construct(
        private array $windows,
        public ProjectGoals $goals,
        private MetricSet $metrics,
    ) {}

    public function value(string $key, string $window = self::PERIOD): ?float
    {
        return self::num($this->windows[$window][$key]['value'] ?? null);
    }

    public function previous(string $key, string $window = self::PERIOD): ?float
    {
        return self::num($this->windows[$window][$key]['previous'] ?? null);
    }

    public function change(string $key, string $window = self::PERIOD): ?float
    {
        return self::num($this->windows[$window][$key]['change_pct'] ?? null);
    }

    /** Valor formatado em pt-BR conforme a unidade da métrica. */
    public function format(string $key, ?float $value): string
    {
        if ($value === null) {
            return '—';
        }

        $unit = $this->metrics->metric($key)->unit ?? MetricUnit::Decimal;

        return match ($unit) {
            MetricUnit::Currency => self::formatter(NumberFormatter::CURRENCY)->formatCurrency($value, 'BRL') ?: (string) $value,
            MetricUnit::Percent => self::decimal($value, 1).'%',
            MetricUnit::Count => self::decimal($value, 0),
            MetricUnit::Duration => self::decimal($value / 60, 1).' min',
            MetricUnit::Decimal => self::decimal($value, 2),
        };
    }

    public static function formatChange(?float $pct): string
    {
        return $pct === null ? '—' : ($pct > 0 ? '+' : '').self::decimal($pct, 1).'%';
    }

    /** Número em pt-BR com casas fixas (ex.: 2,73). */
    public static function decimal(float $value, int $digits): string
    {
        $formatter = self::formatter(NumberFormatter::DECIMAL);
        $formatter->setAttribute(NumberFormatter::MIN_FRACTION_DIGITS, $digits);
        $formatter->setAttribute(NumberFormatter::MAX_FRACTION_DIGITS, $digits);

        return $formatter->format($value) ?: (string) round($value, $digits);
    }

    private static function formatter(int $style): NumberFormatter
    {
        return new NumberFormatter('pt_BR', $style);
    }

    private static function num(mixed $value): ?float
    {
        return is_int($value) || is_float($value) ? (float) $value : null;
    }
}
