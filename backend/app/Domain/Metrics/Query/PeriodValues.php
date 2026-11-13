<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Query;

/** Valores das métricas armazenadas em um período, por chave. */
final readonly class PeriodValues
{
    /**
     * @param  array<string, float|null>  $values
     * @param  array<string, bool>  $approximate  métricas cujo total é estimado (não aditiva somada entre contas)
     */
    public function __construct(
        public array $values,
        public array $approximate = [],
    ) {}
}
