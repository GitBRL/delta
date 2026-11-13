<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Live;

use App\Domain\Integrations\Connector;
use App\Models\IntegrationAccount;
use App\Models\IntegrationConnection;
use Carbon\CarbonImmutable;

/** Google Analytics 4 pela Data API (runReport). Usuários totais do período: consulta sem quebra por dia. */
final readonly class Ga4Connector implements Connector
{
    /** Métrica do GA4 => métrica do Delta. */
    private const METRICS = [
        'sessions' => 'ga4:sessions',
        'totalUsers' => 'ga4:total_users',
        'newUsers' => 'ga4:new_users',
        'engagedSessions' => 'ga4:engaged_sessions',
        'userEngagementDuration' => 'ga4:engagement_duration',
        'keyEvents' => 'ga4:key_events',
        'purchaseRevenue' => 'ga4:purchase_revenue',
    ];

    public function __construct(
        private GoogleApi $google,
        private AccessTokens $tokens,
    ) {}

    public function discoverAccounts(IntegrationConnection $connection): array
    {
        return [];
    }

    public function fetchDaily(IntegrationAccount $account, CarbonImmutable $from, CarbonImmutable $to): iterable
    {
        $names = array_keys(self::METRICS);
        $rows = $this->report($account, [
            'dateRanges' => [['startDate' => $from->toDateString(), 'endDate' => $to->toDateString()]],
            'dimensions' => [['name' => 'date']],
            'metrics' => array_map(fn (string $m): array => ['name' => $m], $names),
            'limit' => 100000,
        ]);

        foreach ($rows as $row) {
            $raw = data_get($row, 'dimensionValues.0.value');
            if (! is_string($raw) || preg_match('/^(\d{4})(\d{2})(\d{2})$/', $raw, $d) !== 1) {
                continue;
            }

            foreach ($names as $i => $name) {
                $value = MetaAdsConnector::num(data_get($row, "metricValues.{$i}.value"));
                if ($value !== null) {
                    yield ['metric' => self::METRICS[$name], 'date' => "{$d[1]}-{$d[2]}-{$d[3]}", 'value' => $value];
                }
            }
        }
    }

    public function fetchPeriod(IntegrationAccount $account, string $metricKey, CarbonImmutable $from, CarbonImmutable $to): ?float
    {
        if ($metricKey !== 'ga4:total_users') {
            return null;
        }

        $rows = $this->report($account, [
            'dateRanges' => [['startDate' => $from->toDateString(), 'endDate' => $to->toDateString()]],
            'metrics' => [['name' => 'totalUsers']],
        ]);

        return MetaAdsConnector::num(data_get($rows, '0.metricValues.0.value')) ?? 0.0;
    }

    /**
     * @param  array<string, mixed>  $body
     * @return list<mixed>
     */
    private function report(IntegrationAccount $account, array $body): array
    {
        $response = $this->google->post(
            "https://analyticsdata.googleapis.com/v1beta/{$account->external_id}:runReport",
            $body,
            $this->tokens->for($account->integration()->firstOrFail()),
            'ga4',
        );
        $rows = $response->json('rows');

        return is_array($rows) ? array_values($rows) : [];
    }
}
