<?php

declare(strict_types=1);

namespace App\Domain\Ai;

/**
 * Guardrail da §7.5: todo número citado pelo modelo precisa existir nos fatos calculados pelo
 * sistema. Compara valores normalizados (1.234,56 = 1234.56; "48,2 mil" = 48.2), com folga de
 * arredondamento. Contagens pequenas (até 12) e anos são liberados ("3 pontos", "2026").
 */
final class NumberGuard
{
    private const PATTERN = '/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/u';

    /** @return list<string> números do texto que não estão nos fatos */
    public static function unverified(string $text, string $facts): array
    {
        $known = self::numbers($facts);
        $bad = [];

        foreach (self::tokens($text) as $raw => $value) {
            if (($value <= 12 && floor($value) == $value) || ($value >= 2000 && $value <= 2100 && floor($value) == $value)) {
                continue;
            }

            $found = false;
            foreach ($known as $k) {
                if (abs($value - $k) <= max(0.005 * abs($k), 0.0051)) {
                    $found = true;
                    break;
                }
            }
            if (! $found) {
                $bad[] = (string) $raw;
            }
        }

        return array_values(array_unique($bad));
    }

    /** @return list<float> */
    private static function numbers(string $text): array
    {
        return array_values(self::tokens($text));
    }

    /** @return array<string, float> número como escrito => valor */
    private static function tokens(string $text): array
    {
        preg_match_all(self::PATTERN, $text, $m);
        $out = [];
        foreach ($m[0] as $raw) {
            $out[$raw] = (float) str_replace(['.', ','], ['', '.'], $raw);
        }

        return $out;
    }
}
