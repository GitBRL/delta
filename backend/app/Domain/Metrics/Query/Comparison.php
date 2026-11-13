<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Query;

use Carbon\CarbonImmutable;

enum Comparison: string
{
    case PreviousPeriod = 'previous_period';
    case PreviousYear = 'previous_year';
    case None = 'none';

    /** @return array{0: CarbonImmutable, 1: CarbonImmutable}|null */
    public function shift(CarbonImmutable $start, CarbonImmutable $end): ?array
    {
        return match ($this) {
            self::PreviousPeriod => (function () use ($start, $end): array {
                $days = (int) $start->diffInDays($end) + 1;

                return [$start->subDays($days), $start->subDay()];
            })(),
            self::PreviousYear => [$start->subYearNoOverflow(), $end->subYearNoOverflow()],
            self::None => null,
        };
    }
}
