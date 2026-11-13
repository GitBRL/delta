<?php

declare(strict_types=1);

namespace App\Domain\Insights;

/** Estado de um indicador no semáforo de atenção. */
enum SignalStatus: string
{
    case Critical = 'critical';
    case Attention = 'attention';
    case Opportunity = 'opportunity';
    case Healthy = 'healthy';

    /** Quanto maior, mais urgente (ordena a lista e decide o estado de uma métrica com vários sinais). */
    public function severity(): int
    {
        return match ($this) {
            self::Critical => 3,
            self::Attention => 2,
            self::Opportunity => 1,
            self::Healthy => 0,
        };
    }
}
