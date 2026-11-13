<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Live;

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\Connector;
use App\Models\IntegrationAccount;
use App\Models\IntegrationConnection;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Log;

/**
 * Instagram profissional (Instagram Graph API com login do Facebook).
 *  - alcance diário: série "day" em janelas de 30 dias;
 *  - novos seguidores: follower_count (a Meta só guarda os últimos 30 dias);
 *  - visualizações e interações: total por dia (metric_type=total_value), últimos 30 dias;
 *  - seguidores: valor atual (followers_count) gravado no último dia — o histórico se forma com as sincronizações;
 *  - publicações: mídia por dia.
 */
final readonly class InstagramConnector implements Connector
{
    private const RECENT_DAYS = 30;

    public function __construct(
        private MetaGraph $graph,
        private AccessTokens $tokens,
    ) {}

    public function discoverAccounts(IntegrationConnection $connection): array
    {
        return [];
    }

    public function fetchDaily(IntegrationAccount $account, CarbonImmutable $from, CarbonImmutable $to): iterable
    {
        $token = $this->tokens->for($account->integration()->firstOrFail());
        $id = $account->external_id;
        $recentFrom = $to->subDays(self::RECENT_DAYS - 1)->max($from);

        foreach (Windows::of($from, $to, 30) as [$start, $end]) {
            yield from $this->series($id, 'reach', 'instagram:reach', $start, $end, $token);
        }
        yield from $this->series($id, 'follower_count', 'instagram:follows', $recentFrom, $to, $token);

        for ($day = $recentFrom; $day->lte($to); $day = $day->addDay()) {
            try {
                $data = $this->graph->get("/{$id}/insights", [
                    'metric' => 'views,total_interactions',
                    'metric_type' => 'total_value',
                    'period' => 'day',
                    'since' => $day->toDateString(),
                    'until' => $day->addDay()->toDateString(),
                ], $token, 'instagram');
            } catch (LiveApiException $e) {
                if ($e->retryable) {
                    throw $e;
                }

                break;
            }

            foreach (is_array($data['data'] ?? null) ? $data['data'] : [] as $metric) {
                $value = MetaAdsConnector::num(data_get($metric, 'total_value.value'));
                $name = data_get($metric, 'name');
                $key = ['views' => 'instagram:views', 'total_interactions' => 'instagram:interactions'][is_string($name) ? $name : ''] ?? null;
                if ($key !== null && $value !== null) {
                    yield ['metric' => $key, 'date' => $day->toDateString(), 'value' => $value];
                }
            }
        }

        $profile = $this->graph->get("/{$id}", ['fields' => 'followers_count'], $token, 'instagram');
        $followers = MetaAdsConnector::num($profile['followers_count'] ?? null);
        if ($followers !== null) {
            yield ['metric' => 'instagram:followers', 'date' => $to->toDateString(), 'value' => $followers];
        }

        $media = [];
        foreach ($this->graph->paginate("/{$id}/media", ['fields' => 'timestamp', 'limit' => 100], $token, 'instagram', maxPages: 20) as $item) {
            $ts = $item['timestamp'] ?? null;
            if (is_string($ts) && CarbonImmutable::parse($ts)->lt($from)) {
                break; // a mídia vem da mais nova para a mais antiga
            }
            $media[] = $ts;
        }
        yield from Windows::countByDay($media, 'instagram:posts', $from, $to, ConnectionManager::timezone());
    }

    public function fetchPeriod(IntegrationAccount $account, string $metricKey, CarbonImmutable $from, CarbonImmutable $to): ?float
    {
        if ($metricKey !== 'instagram:reach' || $from->diffInDays($to) >= 30) {
            return null; // a API só dá alcance único para até 30 dias
        }

        try {
            $data = $this->graph->get('/'.$account->external_id.'/insights', [
                'metric' => 'reach',
                'metric_type' => 'total_value',
                'period' => 'day',
                'since' => $from->toDateString(),
                'until' => $to->addDay()->toDateString(),
            ], $this->tokens->for($account->integration()->firstOrFail()), 'instagram');
        } catch (LiveApiException) {
            return null;
        }

        return MetaAdsConnector::num(data_get($data, 'data.0.total_value.value'));
    }

    /** @return iterable<array{metric: string, date: string, value: float}> */
    private function series(string $id, string $graphMetric, string $metric, CarbonImmutable $from, CarbonImmutable $to, string $token): iterable
    {
        try {
            $data = $this->graph->get("/{$id}/insights", [
                'metric' => $graphMetric,
                'period' => 'day',
                'since' => $from->toDateString(),
                'until' => $to->addDay()->toDateString(),
            ], $token, 'instagram');
        } catch (LiveApiException $e) {
            if ($e->retryable) {
                throw $e;
            }
            Log::warning('Métrica do Instagram indisponível', ['metric' => $graphMetric, 'error' => $e->getMessage()]);

            return;
        }

        foreach (Windows::insightValues($data) as [$date, $value]) {
            if ($date >= $from->toDateString() && $date <= $to->toDateString()) {
                yield ['metric' => $metric, 'date' => $date, 'value' => $value];
            }
        }
    }
}
