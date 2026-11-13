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
 * Páginas do Facebook (Page Insights). Usa o token da PÁGINA, obtido com o token do usuário.
 * Cada métrica vai numa chamada própria: se a Meta descontinuar uma, as outras continuam.
 * A Meta limita cada consulta a ~93 dias; o intervalo é fatiado em janelas de 90.
 */
final class FacebookPageConnector implements Connector
{
    /** Métrica da Graph API => métrica do Delta (valores diários). */
    public const METRICS = [
        'page_impressions_unique' => 'facebook:reach',
        'page_post_engagements' => 'facebook:engagements',
        'page_views_total' => 'facebook:views',
        'page_follows' => 'facebook:followers',
    ];

    /** @var array<string, string> token da página por conta (vale só neste job) */
    private array $pageTokens = [];

    public function __construct(
        private readonly MetaGraph $graph,
        private readonly AccessTokens $tokens,
    ) {}

    public function discoverAccounts(IntegrationConnection $connection): array
    {
        return [];
    }

    public function fetchDaily(IntegrationAccount $account, CarbonImmutable $from, CarbonImmutable $to): iterable
    {
        $token = $this->pageToken($account);

        foreach (Windows::of($from, $to, 90) as [$start, $end]) {
            foreach (self::METRICS as $graphMetric => $metric) {
                try {
                    $series = $this->graph->get('/'.$account->external_id.'/insights', [
                        'metric' => $graphMetric,
                        'period' => 'day',
                        'since' => $start->toDateString(),
                        'until' => $end->addDay()->toDateString(),
                    ], $token, 'facebook');
                } catch (LiveApiException $e) {
                    if ($e->retryable) {
                        throw $e;
                    }
                    Log::warning('Métrica de página indisponível na Graph API', ['metric' => $graphMetric, 'error' => $e->getMessage()]);

                    continue;
                }

                foreach (Windows::insightValues($series) as [$date, $value]) {
                    if ($date >= $start->toDateString() && $date <= $end->toDateString()) {
                        yield ['metric' => $metric, 'date' => $date, 'value' => $value];
                    }
                }
            }
        }

        yield from $this->posts($account, $token, $from, $to);
    }

    public function fetchPeriod(IntegrationAccount $account, string $metricKey, CarbonImmutable $from, CarbonImmutable $to): ?float
    {
        if ($metricKey !== 'facebook:reach' || $from->diffInDays($to) > 92) {
            return null;
        }

        try {
            $data = $this->graph->get('/'.$account->external_id.'/insights', [
                'metric' => 'page_impressions_unique',
                'period' => 'total_over_range',
                'since' => $from->toDateString(),
                'until' => $to->addDay()->toDateString(),
            ], $this->pageToken($account), 'facebook');
        } catch (LiveApiException) {
            return null;
        }

        return MetaAdsConnector::num(data_get($data, 'data.0.values.0.value'));
    }

    /** @return iterable<array{metric: string, date: string, value: float}> */
    private function posts(IntegrationAccount $account, string $token, CarbonImmutable $from, CarbonImmutable $to): iterable
    {
        $posts = $this->graph->paginate('/'.$account->external_id.'/published_posts', [
            'fields' => 'created_time',
            'since' => $from->toDateString(),
            'until' => $to->addDay()->toDateString(),
            'limit' => 100,
        ], $token, 'facebook', maxPages: 40);

        yield from Windows::countByDay(array_map(fn (array $p): mixed => $p['created_time'] ?? null, $posts), 'facebook:posts', $from, $to, ConnectionManager::timezone());
    }

    private function pageToken(IntegrationAccount $account): string
    {
        if (! isset($this->pageTokens[$account->id])) {
            $userToken = $this->tokens->for($account->integration()->firstOrFail());
            $page = $this->graph->get('/'.$account->external_id, ['fields' => 'access_token'], $userToken, 'facebook');
            $this->pageTokens[$account->id] = is_string($page['access_token'] ?? null) ? $page['access_token'] : $userToken;
        }

        return $this->pageTokens[$account->id];
    }
}
