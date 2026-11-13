<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Sandbox;

use Carbon\CarbonImmutable;

/**
 * Sazonalidade plausível para o mercado brasileiro: dia da semana, Black Friday, Natal,
 * janeiro mais fraco e crescimento lento ao longo do tempo.
 */
final class Season
{
    /** @param 'ads'|'social'|'analytics' $profile */
    public static function factor(CarbonImmutable $date, string $profile): float
    {
        return self::weekday($date, $profile) * self::calendar($date, $profile) * self::trend($date);
    }

    public static function isBlackFriday(CarbonImmutable $date): bool
    {
        return $date->month === 11 && $date->day >= 20;
    }

    /** @param 'ads'|'social'|'analytics' $profile */
    private static function weekday(CarbonImmutable $date, string $profile): float
    {
        $weekend = $date->isWeekend();

        return match ($profile) {
            'ads' => $weekend ? 0.9 : 1.03,
            'social' => $weekend ? 1.08 : 0.97,
            'analytics' => $weekend ? 0.78 : 1.08,
        };
    }

    /** @param 'ads'|'social'|'analytics' $profile */
    private static function calendar(CarbonImmutable $date, string $profile): float
    {
        if (self::isBlackFriday($date)) {
            return $profile === 'social' ? 1.15 : 1.55;
        }

        return match ($date->month) {
            12 => $date->day <= 24 ? 1.25 : 0.9,
            1 => 0.85,
            2 => 0.92,
            default => 1.0,
        };
    }

    /** ~18% de crescimento ao ano desde 2024. */
    private static function trend(CarbonImmutable $date): float
    {
        $years = max(0, CarbonImmutable::parse('2024-01-01')->diffInDays($date)) / 365;

        return 1 + 0.18 * $years;
    }
}
