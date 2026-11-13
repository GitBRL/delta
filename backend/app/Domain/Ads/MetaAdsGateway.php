<?php

declare(strict_types=1);

namespace App\Domain\Ads;

use App\Domain\Integrations\Live\AccessTokens;
use App\Domain\Integrations\Live\MetaAdsConnector;
use App\Domain\Integrations\Live\MetaGraph;
use App\Models\IntegrationAccount;

/**
 * Meta Marketing API: campanhas e conjuntos com investimento dos últimos 7 dias; alterações
 * por POST no próprio objeto. Orçamentos vêm e vão em unidades menores da moeda (centavos).
 * Alterar exige ads_management (App Review).
 */
final readonly class MetaAdsGateway implements AdsGateway
{
    /** Moedas sem centavos na Meta (offset 1). */
    private const NO_MINOR = ['JPY', 'KRW', 'CLP', 'ISK', 'VND', 'PYG', 'HUF', 'TWD'];

    private const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];

    private const LEAD = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];

    public function __construct(
        private MetaGraph $graph,
        private AccessTokens $tokens,
    ) {}

    public function campaigns(IntegrationAccount $account): array
    {
        $token = $this->token($account);
        $act = $account->external_id;
        $offset = self::offset($account);

        $campaigns = $this->graph->paginate("/{$act}/campaigns", ['fields' => 'id,name,status,effective_status,objective,daily_budget,lifetime_budget', 'limit' => 200], $token, 'meta_ads');
        $adsets = $this->graph->paginate("/{$act}/adsets", ['fields' => 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget', 'limit' => 500], $token, 'meta_ads');
        $byCampaign = $this->insights($act, 'campaign', $token);
        $byAdset = $this->insights($act, 'adset', $token);

        $children = [];
        foreach ($adsets as $a) {
            $children[self::str($a['campaign_id'] ?? '')][] = [
                'id' => self::str($a['id'] ?? ''),
                'name' => self::str($a['name'] ?? ''),
                'status' => self::str($a['effective_status'] ?? $a['status'] ?? ''),
                'daily_budget' => self::money($a['daily_budget'] ?? null, $offset),
                'lifetime_budget' => self::money($a['lifetime_budget'] ?? null, $offset),
                'spend_7d' => $byAdset[self::str($a['id'] ?? '')]['spend'] ?? 0.0,
            ];
        }

        return array_map(fn (array $c): array => [
            'id' => self::str($c['id'] ?? ''),
            'name' => self::str($c['name'] ?? ''),
            'status' => self::str($c['effective_status'] ?? $c['status'] ?? ''),
            'objective' => is_string($c['objective'] ?? null) ? $c['objective'] : null,
            'daily_budget' => self::money($c['daily_budget'] ?? null, $offset),
            'lifetime_budget' => self::money($c['lifetime_budget'] ?? null, $offset),
            'spend_7d' => $byCampaign[self::str($c['id'] ?? '')]['spend'] ?? 0.0,
            'results_7d' => $byCampaign[self::str($c['id'] ?? '')]['results'] ?? 0.0,
            'adsets' => $children[self::str($c['id'] ?? '')] ?? [],
        ], $campaigns);
    }

    public function setStatus(IntegrationAccount $account, string $objectId, string $status): void
    {
        $this->graph->post('/'.self::id($objectId), ['status' => $status], $this->token($account), 'meta_ads');
    }

    public function setDailyBudget(IntegrationAccount $account, string $objectId, float $amount): void
    {
        $this->graph->post('/'.self::id($objectId), ['daily_budget' => (string) (int) round($amount * self::offset($account))], $this->token($account), 'meta_ads');
    }

    /** @return array<string, array{spend: float, results: float}> */
    private function insights(string $act, string $level, string $token): array
    {
        $rows = $this->graph->paginate("/{$act}/insights", ['level' => $level, 'date_preset' => 'last_7d', 'fields' => "{$level}_id,spend,actions", 'limit' => 500], $token, 'meta_ads');
        $out = [];
        foreach ($rows as $row) {
            $out[self::str($row["{$level}_id"] ?? '')] = [
                'spend' => MetaAdsConnector::num($row['spend'] ?? null) ?? 0.0,
                'results' => MetaAdsConnector::action($row['actions'] ?? null, self::PURCHASE) ?? MetaAdsConnector::action($row['actions'] ?? null, self::LEAD) ?? 0.0,
            ];
        }

        return $out;
    }

    private function token(IntegrationAccount $account): string
    {
        return $this->tokens->for($account->integration()->firstOrFail());
    }

    private static function offset(IntegrationAccount $account): int
    {
        return in_array(strtoupper((string) $account->currency), self::NO_MINOR, true) ? 1 : 100;
    }

    private static function money(mixed $minor, int $offset): ?float
    {
        return is_numeric($minor) && (float) $minor > 0 ? round((float) $minor / $offset, 2) : null;
    }

    /** Ids da Meta são só dígitos: nada de caminho arbitrário na Graph API. */
    private static function id(string $objectId): string
    {
        return preg_match('/^\d{5,30}$/', $objectId) === 1 ? $objectId : throw new \InvalidArgumentException('Id de objeto inválido.');
    }

    private static function str(mixed $value): string
    {
        return is_scalar($value) ? (string) $value : '';
    }
}
