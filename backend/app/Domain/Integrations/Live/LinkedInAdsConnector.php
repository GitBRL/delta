<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Live;

use App\Domain\Integrations\Connector;
use App\Domain\Integrations\ConnectorUnavailable;
use App\Domain\Integrations\OAuth\LinkedInOAuth;
use App\Domain\Integrations\OAuth\OAuthTokens;
use App\Models\IntegrationAccount;
use App\Models\IntegrationConnection;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;

/**
 * LinkedIn Ads pelo adAnalytics (pivot ACCOUNT, granularidade diária). Parâmetros no formato
 * Rest.li 2.0, montados à mão: parênteses e vírgulas não podem ser codificados. ADR 0024.
 */
final readonly class LinkedInAdsConnector implements Connector
{
    /** Campo do LinkedIn → métrica do Delta. */
    private const METRICS = [
        'costInLocalCurrency' => 'linkedin_ads:spend',
        'impressions' => 'linkedin_ads:impressions',
        'clicks' => 'linkedin_ads:clicks',
        'totalEngagements' => 'linkedin_ads:engagements',
        'oneClickLeads' => 'linkedin_ads:leads',
        'externalWebsiteConversions' => 'linkedin_ads:conversions',
    ];

    public function __construct(
        private AccessTokens $tokens,
        private LinkedInOAuth $oauth,
    ) {}

    public function discoverAccounts(IntegrationConnection $connection): array
    {
        return $this->oauth->discoverAccounts('linkedin_ads', new OAuthTokens($this->tokens->for($connection)));
    }

    public function fetchDaily(IntegrationAccount $account, CarbonImmutable $from, CarbonImmutable $to): iterable
    {
        $token = $this->tokens->for($account->integration()->firstOrFail());

        foreach (Windows::of($from, $to, 90) as [$start, $end]) {
            foreach ($this->analytics($account->external_id, $start, $end, $token) as $element) {
                $y = data_get($element, 'dateRange.start.year');
                $m = data_get($element, 'dateRange.start.month');
                $d = data_get($element, 'dateRange.start.day');
                $day = is_int($y) && is_int($m) && is_int($d) ? sprintf('%04d-%02d-%02d', $y, $m, $d) : '';
                // Fora da janela pedida não entra (evita o mesmo dia duas vezes no lote).
                if ($day === '' || $day < $start->toDateString() || $day > $end->toDateString()) {
                    continue;
                }

                $values = [];
                foreach (self::METRICS as $field => $metric) {
                    $values[$metric] = MetaAdsConnector::num(data_get($element, $field)) ?? 0.0;
                }
                yield from MetaAdsConnector::rows($day, $values);
            }
        }
    }

    public function fetchPeriod(IntegrationAccount $account, string $metricKey, CarbonImmutable $from, CarbonImmutable $to): ?float
    {
        return null;
    }

    /** @return list<mixed> */
    private function analytics(string $accountId, CarbonImmutable $from, CarbonImmutable $to, string $token): array
    {
        if (preg_match('/^\d+$/', $accountId) !== 1) {
            throw new LiveApiException('Conta do LinkedIn com identificador inválido.', retryable: false);
        }

        $date = fn (CarbonImmutable $d): string => "(year:{$d->year},month:{$d->month},day:{$d->day})";
        $query = implode('&', [
            'q=analytics',
            'pivot=ACCOUNT',
            'timeGranularity=DAILY',
            'dateRange=(start:'.$date($from).',end:'.$date($to).')',
            'accounts=List('.rawurlencode("urn:li:sponsoredAccount:{$accountId}").')',
            'fields=dateRange,'.implode(',', array_keys(self::METRICS)),
        ]);

        try {
            $response = LinkedInOAuth::rest($token)->get('https://api.linkedin.com/rest/adAnalytics?'.$query);
        } catch (ConnectionException) {
            throw new LiveApiException('Não foi possível falar com o LinkedIn agora.');
        }

        if ($response->status() === 401) {
            throw ConnectorUnavailable::reauthorize('linkedin_ads');
        }
        if ($response->status() === 429 || $response->serverError()) {
            throw new LiveApiException('Limite de chamadas do LinkedIn atingido; nova tentativa em instantes.');
        }
        if ($response->failed()) {
            $message = $response->json('message');

            throw new LiveApiException('O LinkedIn recusou a consulta'.(is_string($message) ? ': '.mb_substr($message, 0, 200) : '.'), retryable: false);
        }

        $elements = $response->json('elements');

        return is_array($elements) ? array_values($elements) : [];
    }
}
