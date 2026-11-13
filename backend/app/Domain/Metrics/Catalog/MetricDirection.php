<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog;

/** Para onde é "bom" a métrica ir. Define a cor da tendência e alimenta o semáforo de atenção. */
enum MetricDirection: string
{
    case HigherIsBetter = 'higher_is_better';
    case LowerIsBetter = 'lower_is_better';
    case Neutral = 'neutral';

    /** @return 'positive'|'negative'|'neutral' */
    public function sentiment(?float $changePct): string
    {
        if ($changePct === null || abs($changePct) < 0.5 || $this === self::Neutral) {
            return 'neutral';
        }

        $up = $changePct > 0;

        return ($up === ($this === self::HigherIsBetter)) ? 'positive' : 'negative';
    }
}
