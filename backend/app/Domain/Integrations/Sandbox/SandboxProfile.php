<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Sandbox;

use Carbon\CarbonImmutable;

/** Gerador de dados de demonstração de uma plataforma. */
interface SandboxProfile
{
    public function accountName(): string;

    public function currency(): ?string;

    /** @return array<string, float> valores do dia para todas as métricas armazenadas da plataforma */
    public function day(Seed $seed, CarbonImmutable $date): array;

    /**
     * Valor de uma métrica não aditiva para um período, a partir dos valores diários dela.
     *
     * @param  list<float>  $daily
     */
    public function period(string $metricKey, array $daily): ?float;
}
