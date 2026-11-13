<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Live;

use App\Domain\Integrations\Connector;
use App\Domain\Integrations\ConnectorUnavailable;
use App\Domain\Integrations\OAuth\OAuthTokens;
use App\Domain\Integrations\OAuth\TikTokOAuth;
use App\Models\IntegrationAccount;
use App\Models\IntegrationConnection;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * TikTok Ads pelo relatório integrado (report/integrated/get), nível anunciante, um valor por dia.
 * A API aceita no máximo 30 dias por consulta diária. Alcance do período vem de uma consulta
 * sem quebra por dia. ADR 0024.
 */
final readonly class TikTokAdsConnector implements Connector
{
    /** Métrica do TikTok → métrica do Delta. */
    private const METRICS = [
        'spend' => 'tiktok_ads:spend',
        'impressions' => 'tiktok_ads:impressions',
        'reach' => 'tiktok_ads:reach',
        'clicks' => 'tiktok_ads:clicks',
        'video_play_actions' => 'tiktok_ads:video_views',
        'video_views_p100' => 'tiktok_ads:video_completions',
        'conversion' => 'tiktok_ads:conversions',
    ];

    /** Token expirado, ausente ou revogado: a agência precisa autorizar de novo. */
    private const AUTH_ERRORS = [40102, 40104, 40105];

    /** Limite de chamadas (40100) e instabilidade do TikTok (5xxxx): tenta de novo depois. */
    private const RETRYABLE = [40100, 50000, 50002];

    public function __construct(
        private AccessTokens $tokens,
        private TikTokOAuth $oauth,
    ) {}

    public function discoverAccounts(IntegrationConnection $connection): array
    {
        return $this->oauth->discoverAccounts('tiktok_ads', new OAuthTokens($this->tokens->for($connection)));
    }

    public function fetchDaily(IntegrationAccount $account, CarbonImmutable $from, CarbonImmutable $to): iterable
    {
        $token = $this->tokens->for($account->integration()->firstOrFail());

        foreach (Windows::of($from, $to, 30) as [$start, $end]) {
            foreach ($this->report($account->external_id, ['stat_time_day'], array_keys(self::METRICS), $start, $end, $token) as $row) {
                $day = data_get($row, 'dimensions.stat_time_day');
                $day = is_string($day) ? substr($day, 0, 10) : '';
                // Fora da janela pedida não entra (evita o mesmo dia duas vezes no lote).
                if (strlen($day) !== 10 || $day < $start->toDateString() || $day > $end->toDateString()) {
                    continue;
                }

                $values = [];
                foreach (self::METRICS as $source => $metric) {
                    $values[$metric] = MetaAdsConnector::num(data_get($row, "metrics.{$source}"));
                }
                yield from MetaAdsConnector::rows($day, $values);
            }
        }
    }

    public function fetchPeriod(IntegrationAccount $account, string $metricKey, CarbonImmutable $from, CarbonImmutable $to): ?float
    {
        if ($metricKey !== 'tiktok_ads:reach') {
            return null;
        }

        $rows = $this->report($account->external_id, ['advertiser_id'], ['reach'], $from, $to, $this->tokens->for($account->integration()->firstOrFail()));

        return MetaAdsConnector::num(data_get($rows, '0.metrics.reach'));
    }

    /**
     * @param  list<string>  $dimensions
     * @param  list<string>  $metrics
     * @return list<mixed>
     */
    private function report(string $advertiserId, array $dimensions, array $metrics, CarbonImmutable $from, CarbonImmutable $to, string $token): array
    {
        $rows = [];
        for ($page = 1, $pages = 1; $page <= $pages && $page <= 20; $page++) {
            try {
                $response = Http::timeout(30)->acceptJson()->withHeaders(['Access-Token' => $token])->get(TikTokOAuth::API.'/report/integrated/get/', [
                    'advertiser_id' => $advertiserId,
                    'report_type' => 'BASIC',
                    'data_level' => 'AUCTION_ADVERTISER',
                    'dimensions' => json_encode($dimensions),
                    'metrics' => json_encode($metrics),
                    'start_date' => $from->toDateString(),
                    'end_date' => $to->toDateString(),
                    'page' => $page,
                    'page_size' => 1000,
                ]);
            } catch (ConnectionException) {
                throw new LiveApiException('Não foi possível falar com o TikTok agora.');
            }

            $code = $response->json('code');
            if ($response->status() === 401 || in_array($code, self::AUTH_ERRORS, true)) {
                throw ConnectorUnavailable::reauthorize('tiktok_ads');
            }
            if ($response->status() === 429 || $response->serverError() || in_array($code, self::RETRYABLE, true)) {
                throw new LiveApiException('Limite de chamadas do TikTok atingido; nova tentativa em instantes.');
            }
            if ($response->failed() || $code !== 0) {
                $message = $response->json('message');

                throw new LiveApiException('O TikTok recusou a consulta'.(is_string($message) ? ': '.mb_substr($message, 0, 200) : '.'), retryable: false);
            }

            $list = $response->json('data.list');
            foreach (is_array($list) ? $list : [] as $row) {
                $rows[] = $row;
            }
            $total = $response->json('data.page_info.total_page');
            $pages = is_int($total) ? $total : 1;
        }

        return $rows;
    }
}
