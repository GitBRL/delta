<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Sandbox\Profiles;

/**
 * Público único de um período a partir dos valores diários: as mesmas pessoas aparecem em
 * vários dias, então o total do período é menor que a soma (sobreposição cresce com o log
 * do número de dias) e nunca menor que o maior dia.
 */
final class UniqueAudience
{
    /** @param list<float> $daily */
    public static function of(array $daily, float $overlap): ?float
    {
        if ($daily === []) {
            return null;
        }

        $days = count($daily);
        $estimate = array_sum($daily) / (1 + $overlap * log($days));

        return round(max($estimate, max($daily)));
    }

    /** @param list<float> $daily */
    public static function mean(array $daily): ?float
    {
        return $daily === [] ? null : array_sum($daily) / count($daily);
    }
}
