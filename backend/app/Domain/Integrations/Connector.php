<?php

declare(strict_types=1);

namespace App\Domain\Integrations;

use App\Models\IntegrationAccount;
use App\Models\IntegrationConnection;
use Carbon\CarbonImmutable;

/**
 * Contrato de toda integração de dados (Meta Ads, Google Ads, GA4...).
 * Mesmo contrato para o modo demonstração e para as APIs reais.
 */
interface Connector
{
    /** @return list<DiscoveredAccount> contas acessíveis pela conexão */
    public function discoverAccounts(IntegrationConnection $connection): array;

    /**
     * Valores diários das métricas armazenadas (todas exceto as derivadas), de $from a $to inclusive.
     *
     * @return iterable<array{metric: string, date: string, value: float}>
     */
    public function fetchDaily(IntegrationAccount $account, CarbonImmutable $from, CarbonImmutable $to): iterable;

    /** Valor de uma métrica não aditiva para o período exato (alcance, usuários únicos). */
    public function fetchPeriod(IntegrationAccount $account, string $metricKey, CarbonImmutable $from, CarbonImmutable $to): ?float;
}
