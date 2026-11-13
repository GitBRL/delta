<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Live;

use App\Domain\Integrations\Connector;
use App\Domain\Integrations\DiscoveredAccount;
use App\Models\IntegrationAccount;
use App\Models\IntegrationConnection;
use Carbon\CarbonImmutable;

/**
 * Meta Ads pela Marketing API (insights por conta, um valor por dia).
 * Conversões = compras (omni_purchase › purchase › pixel); sem compras no dia, leads.
 * Alcance é não aditivo: o do período exato vem de uma consulta sem quebra diária.
 */
final readonly class MetaAdsConnector implements Connector
{
    private const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];

    private const LEAD = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];

    public function __construct(
        private MetaGraph $graph,
        private AccessTokens $tokens,
    ) {}

    public function discoverAccounts(IntegrationConnection $connection): array
    {
        $rows = $this->graph->paginate('/me/adaccounts', ['fields' => 'account_id,name,currency,timezone_name', 'limit' => 200], $this->tokens->for($connection), 'meta_ads');

        return array_map(fn (array $a): DiscoveredAccount => new DiscoveredAccount(
            'act_'.self::str($a['account_id'] ?? ''), self::str($a['name'] ?? 'Conta de anúncios'), 'ad_account',
            self::str($a['currency'] ?? '') ?: null, self::str($a['timezone_name'] ?? '') ?: null,
        ), $rows);
    }

    public function fetchDaily(IntegrationAccount $account, CarbonImmutable $from, CarbonImmutable $to): iterable
    {
        $rows = $this->graph->paginate('/'.$account->external_id.'/insights', [
            'level' => 'account',
            'time_increment' => 1,
            'time_range' => json_encode(['since' => $from->toDateString(), 'until' => $to->toDateString()]),
            'fields' => 'spend,impressions,reach,inline_link_clicks,actions,action_values',
            'limit' => 500,
        ], $this->token($account), 'meta_ads');

        foreach ($rows as $row) {
            $date = self::str($row['date_start'] ?? '');
            if ($date === '') {
                continue;
            }

            $purchases = self::action($row['actions'] ?? null, self::PURCHASE);
            $leads = self::action($row['actions'] ?? null, self::LEAD);

            yield from self::rows($date, [
                'meta_ads:spend' => self::num($row['spend'] ?? null),
                'meta_ads:impressions' => self::num($row['impressions'] ?? null),
                'meta_ads:reach' => self::num($row['reach'] ?? null),
                'meta_ads:link_clicks' => self::num($row['inline_link_clicks'] ?? null),
                'meta_ads:conversions' => $purchases ?? $leads ?? 0.0,
                'meta_ads:conversion_value' => self::action($row['action_values'] ?? null, self::PURCHASE) ?? 0.0,
                'meta_ads:leads' => $leads ?? 0.0,
            ]);
        }
    }

    public function fetchPeriod(IntegrationAccount $account, string $metricKey, CarbonImmutable $from, CarbonImmutable $to): ?float
    {
        if ($metricKey !== 'meta_ads:reach') {
            return null;
        }

        $data = $this->graph->get('/'.$account->external_id.'/insights', [
            'level' => 'account',
            'time_range' => json_encode(['since' => $from->toDateString(), 'until' => $to->toDateString()]),
            'fields' => 'reach',
        ], $this->token($account), 'meta_ads');

        return self::num(data_get($data, 'data.0.reach'));
    }

    private function token(IntegrationAccount $account): string
    {
        return $this->tokens->for($account->integration()->firstOrFail());
    }

    /**
     * Primeiro tipo de ação encontrado, na ordem de preferência (a Meta repete a mesma compra em vários tipos).
     *
     * @param  list<string>  $types
     */
    public static function action(mixed $list, array $types): ?float
    {
        if (! is_array($list)) {
            return null;
        }

        $byType = [];
        foreach ($list as $item) {
            $type = is_array($item) ? ($item['action_type'] ?? null) : null;
            if (is_array($item) && is_string($type)) {
                $byType[$type] = self::num($item['value'] ?? null);
            }
        }

        foreach ($types as $type) {
            if (array_key_exists($type, $byType)) {
                return $byType[$type];
            }
        }

        return null;
    }

    /**
     * @param  array<string, float|null>  $values
     * @return iterable<array{metric: string, date: string, value: float}>
     */
    public static function rows(string $date, array $values): iterable
    {
        foreach ($values as $metric => $value) {
            if ($value !== null) {
                yield ['metric' => $metric, 'date' => $date, 'value' => $value];
            }
        }
    }

    public static function num(mixed $value): ?float
    {
        return is_numeric($value) ? (float) $value : null;
    }

    private static function str(mixed $value): string
    {
        return is_scalar($value) ? (string) $value : '';
    }
}
