<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog;

enum MetricUnit: string
{
    case Count = 'count';
    case Currency = 'currency';
    /** Valor já em 0–100. */
    case Percent = 'percent';
    case Decimal = 'decimal';
    /** Segundos. */
    case Duration = 'duration';
}
