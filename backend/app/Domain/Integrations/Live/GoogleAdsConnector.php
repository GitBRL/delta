<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Live;

use App\Domain\Integrations\Connector;
use App\Domain\Integrations\OAuth\Apps\AppVendor;
use App\Domain\Integrations\OAuth\Apps\PlatformApps;
use App\Models\IntegrationAccount;
use App\Models\IntegrationConnection;
use Carbon\CarbonImmutable;

/**
 * Google Ads pela API (GAQL via searchStream), com o developer token do app da agência.
 * Custo vem em micros; parcela de impressões vem de 0 a 1 (gravada em %), e a do período
 * exato sai de uma consulta sem quebra por dia (não aditiva).
 */
final readonly class GoogleAdsConnector implements Connector
{
    public function __construct(
        private GoogleApi $google,
        private AccessTokens $tokens,
        private PlatformApps $apps,
    ) {}

    public function discoverAccounts(IntegrationConnection $connection): array
    {
        return [];
    }

    public function fetchDaily(IntegrationAccount $account, CarbonImmutable $from, CarbonImmutable $to): iterable
    {
        $rows = $this->search($account, 'SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, '
            .'metrics.conversions_value, metrics.search_impression_share FROM customer '
            ."WHERE segments.date BETWEEN '{$from->toDateString()}' AND '{$to->toDateString()}'");

        foreach ($rows as $row) {
            $date = data_get($row, 'segments.date');
            if (! is_string($date)) {
                continue;
            }

            $cost = MetaAdsConnector::num(data_get($row, 'metrics.costMicros'));
            $share = MetaAdsConnector::num(data_get($row, 'metrics.searchImpressionShare'));

            yield from MetaAdsConnector::rows($date, [
                'google_ads:cost' => $cost === null ? null : $cost / 1_000_000,
                'google_ads:impressions' => MetaAdsConnector::num(data_get($row, 'metrics.impressions')),
                'google_ads:clicks' => MetaAdsConnector::num(data_get($row, 'metrics.clicks')),
                'google_ads:conversions' => MetaAdsConnector::num(data_get($row, 'metrics.conversions')),
                'google_ads:conversion_value' => MetaAdsConnector::num(data_get($row, 'metrics.conversionsValue')),
                'google_ads:search_impression_share' => $share === null ? null : round($share * 100, 2),
            ]);
        }
    }

    public function fetchPeriod(IntegrationAccount $account, string $metricKey, CarbonImmutable $from, CarbonImmutable $to): ?float
    {
        if ($metricKey !== 'google_ads:search_impression_share') {
            return null;
        }

        $rows = $this->search($account, 'SELECT metrics.search_impression_share FROM customer '
            ."WHERE segments.date BETWEEN '{$from->toDateString()}' AND '{$to->toDateString()}'");
        $share = MetaAdsConnector::num(data_get($rows, '0.metrics.searchImpressionShare'));

        return $share === null ? null : round($share * 100, 2);
    }

    /** @return list<mixed> resultados de todos os lotes do stream */
    private function search(IntegrationAccount $account, string $query): array
    {
        $version = config('services.google.ads_api_version');
        $version = is_string($version) && $version !== '' ? $version : 'v22';
        $developerToken = $this->apps->credentials(AppVendor::Google)->developerToken
            ?? throw new LiveApiException('Falta o developer token do Google Ads em Integrações › Apps das plataformas.', retryable: false);

        $customer = preg_replace('/\D/', '', $account->external_id);
        $response = $this->google->post(
            "https://googleads.googleapis.com/{$version}/customers/{$customer}/googleAds:searchStream",
            ['query' => $query],
            $this->tokens->for($account->integration()->firstOrFail()),
            'google_ads',
            ['developer-token' => $developerToken],
        );

        $results = [];
        $batches = $response->json();
        foreach (is_array($batches) ? $batches : [] as $batch) {
            foreach (is_array($batch) && is_array($batch['results'] ?? null) ? $batch['results'] : [] as $row) {
                $results[] = $row;
            }
        }

        return $results;
    }
}
