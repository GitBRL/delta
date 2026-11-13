<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Query;

use App\Domain\Metrics\Catalog\MetricSet;
use App\Models\Project;
use Carbon\CarbonImmutable;

final readonly class MetricQuery
{
    /** @param list<string> $metrics */
    public function __construct(
        public Project $project,
        public CarbonImmutable $start,
        public CarbonImmutable $end,
        public Comparison $comparison,
        public array $metrics,
        public bool $withSeries = false,
        /** Métricas visíveis (catálogo + indicadores); nulo = as da agência do contexto. */
        public ?MetricSet $set = null,
    ) {}
}
