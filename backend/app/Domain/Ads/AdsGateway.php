<?php

declare(strict_types=1);

namespace App\Domain\Ads;

use App\Models\IntegrationAccount;

/**
 * Leitura e alteração de campanhas e conjuntos de uma conta de anúncios (ADR 0030).
 *
 * @phpstan-type AdSet array{id: string, name: string, status: string, daily_budget: float|null, lifetime_budget: float|null, spend_7d: float}
 * @phpstan-type Campaign array{id: string, name: string, status: string, objective: string|null, daily_budget: float|null, lifetime_budget: float|null, spend_7d: float, results_7d: float, adsets: list<AdSet>}
 */
interface AdsGateway
{
    /** @return list<Campaign> */
    public function campaigns(IntegrationAccount $account): array;

    /** @param 'ACTIVE'|'PAUSED' $status */
    public function setStatus(IntegrationAccount $account, string $objectId, string $status): void;

    public function setDailyBudget(IntegrationAccount $account, string $objectId, float $amount): void;
}
