<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Live;

use App\Domain\Integrations\Connector;
use App\Models\IntegrationAccount;
use App\Models\IntegrationConnection;
use Carbon\CarbonImmutable;

/**
 * Coletores do Search Console, YouTube e Perfil da Empresa no Google (mesmo app OAuth do Google).
 *  - Search Console: searchAnalytics.query por data; posição gravada como posição × impressões
 *    (a média do período sai ponderada, como no painel do Google).
 *  - YouTube: YouTube Analytics por dia + inscritos atuais (estatísticas do canal) no último dia.
 *  - Perfil da Empresa: séries diárias da Business Profile Performance API; visualizações somam
 *    Busca e Maps, no computador e no celular.
 */
final readonly class GoogleExtrasConnector implements Connector
{
    private const BUSINESS_IMPRESSIONS = ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH'];

    private const BUSINESS_ACTIONS = ['CALL_CLICKS' => 'google_business:calls', 'WEBSITE_CLICKS' => 'google_business:website_clicks', 'BUSINESS_DIRECTION_REQUESTS' => 'google_business:directions'];

    private const YOUTUBE = ['views' => 'youtube:views', 'estimatedMinutesWatched' => 'youtube:watch_minutes', 'subscribersGained' => 'youtube:subscribers_gained',
        'subscribersLost' => 'youtube:subscribers_lost', 'likes' => 'youtube:likes', 'comments' => 'youtube:comments', 'shares' => 'youtube:shares'];

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
        $token = $this->tokens->for($account->integration()->firstOrFail());

        return match ($account->provider) {
            'search_console' => $this->searchConsole($account->external_id, $from, $to, $token),
            'youtube' => $this->youtube($account->external_id, $from, $to, $token),
            'google_business' => $this->business($account->external_id, $from, $to, $token),
            default => [],
        };
    }

    public function fetchPeriod(IntegrationAccount $account, string $metricKey, CarbonImmutable $from, CarbonImmutable $to): ?float
    {
        return null; // nenhuma métrica não aditiva nestes canais
    }

    /** @return iterable<array{metric: string, date: string, value: float}> */
    private function searchConsole(string $site, CarbonImmutable $from, CarbonImmutable $to, string $token): iterable
    {
        $rows = $this->google->post('https://www.googleapis.com/webmasters/v3/sites/'.rawurlencode($site).'/searchAnalytics/query', [
            'startDate' => $from->toDateString(), 'endDate' => $to->toDateString(), 'dimensions' => ['date'], 'rowLimit' => 25000,
        ], $token, 'search_console')->json('rows');

        foreach (is_array($rows) ? $rows : [] as $row) {
            $date = data_get($row, 'keys.0');
            $impressions = MetaAdsConnector::num(data_get($row, 'impressions'));
            $position = MetaAdsConnector::num(data_get($row, 'position'));
            if (! is_string($date)) {
                continue;
            }
            yield from MetaAdsConnector::rows($date, [
                'search_console:clicks' => MetaAdsConnector::num(data_get($row, 'clicks')),
                'search_console:impressions' => $impressions,
                'search_console:position_sum' => $impressions !== null && $position !== null ? round($impressions * $position, 4) : null,
            ]);
        }
    }

    /** @return iterable<array{metric: string, date: string, value: float}> */
    private function youtube(string $channel, CarbonImmutable $from, CarbonImmutable $to, string $token): iterable
    {
        $report = $this->google->get('https://youtubeanalytics.googleapis.com/v2/reports', http_build_query([
            'ids' => "channel=={$channel}", 'startDate' => $from->toDateString(), 'endDate' => $to->toDateString(),
            'metrics' => implode(',', array_keys(self::YOUTUBE)), 'dimensions' => 'day', 'sort' => 'day',
        ]), $token, 'youtube');

        $headers = array_map(fn (mixed $h): string => is_string(data_get($h, 'name')) ? (string) data_get($h, 'name') : '', (array) $report->json('columnHeaders'));
        foreach ((array) $report->json('rows') as $row) {
            $values = is_array($row) ? array_combine(array_slice($headers, 0, count($row)), $row) : [];
            $date = $values['day'] ?? null;
            if (! is_string($date)) {
                continue;
            }
            foreach (self::YOUTUBE as $column => $metric) {
                $value = MetaAdsConnector::num($values[$column] ?? null);
                if ($value !== null) {
                    yield ['metric' => $metric, 'date' => $date, 'value' => $value];
                }
            }
        }

        $stats = $this->google->get('https://www.googleapis.com/youtube/v3/channels', http_build_query(['part' => 'statistics', 'id' => $channel]), $token, 'youtube');
        $subscribers = MetaAdsConnector::num($stats->json('items.0.statistics.subscriberCount'));
        if ($subscribers !== null) {
            yield ['metric' => 'youtube:subscribers', 'date' => $to->toDateString(), 'value' => $subscribers];
        }
    }

    /** @return iterable<array{metric: string, date: string, value: float}> */
    private function business(string $location, CarbonImmutable $from, CarbonImmutable $to, string $token): iterable
    {
        $metrics = [...self::BUSINESS_IMPRESSIONS, ...array_keys(self::BUSINESS_ACTIONS)];
        $query = implode('&', array_map(fn (string $m): string => 'dailyMetrics='.$m, $metrics)).'&'.http_build_query([
            'dailyRange.start_date.year' => $from->year, 'dailyRange.start_date.month' => $from->month, 'dailyRange.start_date.day' => $from->day,
            'dailyRange.end_date.year' => $to->year, 'dailyRange.end_date.month' => $to->month, 'dailyRange.end_date.day' => $to->day,
        ]);
        $series = $this->google->get("https://businessprofileperformance.googleapis.com/v1/{$location}:fetchMultiDailyMetricsTimeSeries", $query, $token, 'google_business')
            ->json('multiDailyMetricTimeSeries.0.dailyMetricTimeSeries');

        $impressions = [];
        foreach (is_array($series) ? $series : [] as $metricSeries) {
            $name = data_get($metricSeries, 'dailyMetric');
            foreach ((array) data_get($metricSeries, 'timeSeries.datedValues', []) as $point) {
                $y = data_get($point, 'date.year');
                $m = data_get($point, 'date.month');
                $d = data_get($point, 'date.day');
                if (! is_int($y) || ! is_int($m) || ! is_int($d)) {
                    continue;
                }
                $date = sprintf('%04d-%02d-%02d', $y, $m, $d);
                $value = MetaAdsConnector::num(data_get($point, 'value')) ?? 0.0; // dia sem valor = 0

                if (in_array($name, self::BUSINESS_IMPRESSIONS, true)) {
                    $impressions[$date] = ($impressions[$date] ?? 0.0) + $value;
                } elseif (is_string($name) && isset(self::BUSINESS_ACTIONS[$name])) {
                    yield ['metric' => self::BUSINESS_ACTIONS[$name], 'date' => $date, 'value' => $value];
                }
            }
        }

        foreach ($impressions as $date => $value) {
            yield ['metric' => 'google_business:impressions', 'date' => $date, 'value' => $value];
        }
    }
}
