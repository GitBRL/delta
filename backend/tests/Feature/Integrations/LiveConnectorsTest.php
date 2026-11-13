<?php

declare(strict_types=1);

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\ConnectorUnavailable;
use App\Domain\Integrations\DiscoveredAccount;
use App\Domain\Integrations\Live\LiveApiException;
use App\Domain\Integrations\Live\MetaGraph;
use App\Domain\Integrations\OAuth\OAuthTokens;
use App\Models\IntegrationConnection;
use App\Models\Project;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Loja Aurora']));
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->d1 = ConnectionManager::yesterday()->subDay()->toDateString();
    $this->d2 = ConnectionManager::yesterday()->toDateString();
    Http::preventStrayRequests();
});

/** Conecta uma conta real (como o pop-up faria) e vincula ao projeto; a primeira coleta roda na hora (fila "sync"). */
function connectLive(string $provider, DiscoveredAccount $account, OAuthTokens $tokens): IntegrationConnection
{
    $t = test();
    $connection = security()->run($t->tenant->id, $t->owner->id, function () use ($provider, $account, $tokens, $t): IntegrationConnection {
        $connection = app(ConnectionManager::class)->connectLive($provider, $tokens, [$account], $t->owner->id);
        $t->project->accounts()->sync($connection->accounts()->pluck('id')->all());

        return $connection->refresh();
    });
    security()->clear();

    return $connection;
}

/** @return array<string, float|null> */
function values(array $metrics, string $start, string $end): array
{
    $t = test();
    $data = $t->actingAs($t->owner)->postJson("/api/projects/{$t->project->id}/metrics/query", [
        'start' => $start, 'end' => $end, 'compare' => 'none', 'metrics' => $metrics,
    ], $t->headers)->assertOk()->json('data.metrics');

    return collect($data)->pluck('value', 'key')->all();
}

it('coleta Meta Ads: compras com prioridade, leads, alcance do período exato e token no cabeçalho', function () {
    Http::fake(['graph.facebook.com/v24.0/act_111/insights*' => function (Request $r) {
        if (! str_contains($r->url(), 'time_increment')) {
            return Http::response(['data' => [['reach' => '1000']]]); // período exato
        }

        return Http::response(['data' => [
            ['date_start' => $this->d1, 'spend' => '100.50', 'impressions' => '1000', 'reach' => '800', 'inline_link_clicks' => '50',
                'actions' => [['action_type' => 'omni_purchase', 'value' => '5'], ['action_type' => 'purchase', 'value' => '5'], ['action_type' => 'lead', 'value' => '2']],
                'action_values' => [['action_type' => 'omni_purchase', 'value' => '500']]],
            ['date_start' => $this->d2, 'spend' => '50', 'impressions' => '400', 'reach' => '300', 'inline_link_clicks' => '20',
                'actions' => [['action_type' => 'lead', 'value' => '3']]],
        ]]);
    }]);

    $connection = connectLive('meta_ads', new DiscoveredAccount('act_111', 'Loja', 'ad_account', 'BRL'), new OAuthTokens('token-meta', null, CarbonImmutable::now()->addDays(50)));
    $v = values(['meta_ads:spend', 'meta_ads:conversions', 'meta_ads:conversion_value', 'meta_ads:leads', 'meta_ads:reach', 'meta_ads:roas'], $this->d1, $this->d2);

    expect($connection->status)->toBe('active')
        ->and($v['meta_ads:spend'])->toBe(150.5)
        ->and($v['meta_ads:conversions'])->toEqual(8)  // 5 compras (sem duplicar omni/purchase) + 3 leads no dia sem compra
        ->and($v['meta_ads:conversion_value'])->toEqual(500)
        ->and($v['meta_ads:leads'])->toEqual(5)
        ->and($v['meta_ads:reach'])->toEqual(1000)     // não é 800 + 300
        ->and($v['meta_ads:roas'])->toEqualWithDelta(500 / 150.5, 0.01);

    Http::assertSent(fn (Request $r) => $r->hasHeader('Authorization', 'Bearer token-meta') && ! str_contains($r->url(), 'token-meta'));
});

it('coleta Google Ads com developer token, custo em micros e parcela de impressões em %', function () {
    config(['services.google.client_id' => 'c.apps.googleusercontent.com', 'services.google.client_secret' => 'segredo', 'services.google.ads_developer_token' => 'DEVTOKEN123456']);
    Http::fake(['googleads.googleapis.com/v22/customers/1234567890/googleAds:searchStream' => function (Request $r) {
        if (! str_contains((string) $r['query'], 'segments.date,')) {
            return Http::response([['results' => [['metrics' => ['searchImpressionShare' => 0.37]]]]]);
        }

        return Http::response([['results' => [
            ['segments' => ['date' => $this->d1], 'metrics' => ['costMicros' => '12500000', 'impressions' => '1000', 'clicks' => '40', 'conversions' => 2.0, 'conversionsValue' => 300.0, 'searchImpressionShare' => 0.42]],
            ['segments' => ['date' => $this->d2], 'metrics' => ['costMicros' => '7500000', 'impressions' => '500', 'clicks' => '10', 'conversions' => 1.0, 'conversionsValue' => 100.0, 'searchImpressionShare' => 0.3]],
        ]]]);
    }]);

    connectLive('google_ads', new DiscoveredAccount('1234567890', 'Google Ads 123-456-7890', 'ad_account'), new OAuthTokens('ya29.token', '1//refresh', CarbonImmutable::now()->addHour()));
    $v = values(['google_ads:cost', 'google_ads:clicks', 'google_ads:conversion_value', 'google_ads:search_impression_share'], $this->d1, $this->d2);

    expect($v['google_ads:cost'])->toEqual(20)
        ->and($v['google_ads:clicks'])->toEqual(50)
        ->and($v['google_ads:conversion_value'])->toEqual(400)
        ->and($v['google_ads:search_impression_share'])->toEqual(37);

    Http::assertSent(fn (Request $r) => $r->hasHeader('developer-token', 'DEVTOKEN123456') && $r->hasHeader('Authorization', 'Bearer ya29.token'));
});

it('coleta GA4 e renova o token vencido uma vez só, gravando o novo', function () {
    config(['services.google.client_id' => 'c.apps.googleusercontent.com', 'services.google.client_secret' => 'segredo']);
    Http::fake([
        'oauth2.googleapis.com/token' => Http::response(['access_token' => 'ya29.novo', 'expires_in' => 3599]),
        'analyticsdata.googleapis.com/v1beta/properties/987:runReport' => function (Request $r) {
            if (! isset($r['dimensions'])) {
                return Http::response(['rows' => [['metricValues' => [['value' => '150']]]]]);
            }

            return Http::response(['rows' => [
                ['dimensionValues' => [['value' => str_replace('-', '', $this->d1)]], 'metricValues' => array_map(fn ($v) => ['value' => $v], ['100', '80', '20', '60', '1200', '4', '250.5'])],
                ['dimensionValues' => [['value' => str_replace('-', '', $this->d2)]], 'metricValues' => array_map(fn ($v) => ['value' => $v], ['50', '40', '10', '30', '600', '1', '0'])],
            ]]);
        },
    ]);

    $connection = connectLive('ga4', new DiscoveredAccount('properties/987', 'Site', 'property'), new OAuthTokens('ya29.velho', '1//refresh', CarbonImmutable::now()->subMinute()));
    $v = values(['ga4:sessions', 'ga4:total_users', 'ga4:key_events', 'ga4:purchase_revenue'], $this->d1, $this->d2);

    expect($v['ga4:sessions'])->toEqual(150)
        ->and($v['ga4:total_users'])->toEqual(150) // do período exato, não 80 + 40
        ->and($v['ga4:key_events'])->toEqual(5)
        ->and($v['ga4:purchase_revenue'])->toEqual(250.5)
        ->and(security()->run($this->tenant->id, null, fn () => $connection->refresh()->credentials['access_token']))->toBe('ya29.novo');

    Http::assertSentCount(3); // 1 renovação + relatório diário + total de usuários do período
    Http::assertSent(fn (Request $r) => str_contains($r->url(), 'runReport') && $r->hasHeader('Authorization', 'Bearer ya29.novo'));
    Http::assertNotSent(fn (Request $r) => $r->hasHeader('Authorization', 'Bearer ya29.velho'));
});

it('marca a conexão para reconectar quando o acesso foi revogado ou expirou', function () {
    config(['services.google.client_id' => 'c.apps.googleusercontent.com', 'services.google.client_secret' => 'segredo']);
    Http::fake(['oauth2.googleapis.com/token' => Http::response(['error' => 'invalid_grant'], 400)]);

    $google = connectLive('ga4', new DiscoveredAccount('properties/1', 'Site', 'property'), new OAuthTokens('a', '1//revogado', CarbonImmutable::now()->subMinute()));
    $meta = connectLive('meta_ads', new DiscoveredAccount('act_9', 'Conta', 'ad_account'), new OAuthTokens('b', null, CarbonImmutable::now()->subDay()));

    expect($google->status)->toBe('expired')
        ->and($google->last_error)->toContain('Reconecte')
        ->and($meta->status)->toBe('expired');

    $list = collect($this->actingAs($this->owner)->getJson('/api/connections', $this->headers)->json('data'))->keyBy('provider');
    expect($list['meta_ads']['expiring_soon'])->toBeTrue();
});

it('coleta a página do Facebook com o token da página e ignora métrica descontinuada', function () {
    $endTime = fn (string $date) => CarbonImmutable::parse($date)->addDay()->format('Y-m-d\T07:00:00+0000');
    Http::fake([
        'graph.facebook.com/v24.0/555?fields=access_token' => Http::response(['access_token' => 'page-token', 'id' => '555']),
        'graph.facebook.com/v24.0/555/insights*' => function (Request $r) use ($endTime) {
            parse_str((string) parse_url($r->url(), PHP_URL_QUERY), $q);
            if (($q['period'] ?? '') === 'total_over_range') {
                return Http::response(['data' => [['values' => [['value' => 900]]]]]);
            }

            return match ($q['metric']) {
                'page_views_total' => Http::response(['error' => ['code' => 100, 'message' => 'The value must be a valid insights metric']], 400),
                default => Http::response(['data' => [['name' => $q['metric'], 'values' => [
                    ['value' => 400, 'end_time' => $endTime($this->d1)], ['value' => 600, 'end_time' => $endTime($this->d2)],
                ]]]]),
            };
        },
        'graph.facebook.com/v24.0/555/published_posts*' => Http::response(['data' => [
            ['created_time' => $this->d1.'T15:00:00+0000'], ['created_time' => $this->d1.'T20:00:00+0000'],
        ]]),
    ]);

    $connection = connectLive('facebook', new DiscoveredAccount('555', 'Página', 'page'), new OAuthTokens('user-token', null, CarbonImmutable::now()->addDays(50)));
    $v = values(['facebook:engagements', 'facebook:reach', 'facebook:posts', 'facebook:followers', 'facebook:views'], $this->d1, $this->d2);

    expect($connection->status)->toBe('active')
        ->and($v['facebook:engagements'])->toEqual(1000)
        ->and($v['facebook:reach'])->toEqual(900)
        ->and($v['facebook:posts'])->toEqual(2)
        ->and($v['facebook:followers'])->toEqual(600) // último dia do período
        ->and($v['facebook:views'])->toBeNull();

    Http::assertSent(fn (Request $r) => str_contains($r->url(), '/555/insights') && $r->hasHeader('Authorization', 'Bearer page-token'));
});

it('traduz os erros da Graph API', function () {
    Http::fake([
        'graph.facebook.com/v24.0/limite*' => Http::response(['error' => ['code' => 17, 'message' => 'User request limit reached']], 400),
        'graph.facebook.com/v24.0/revogado*' => Http::response(['error' => ['code' => 190, 'message' => 'Error validating access token']], 400),
        'graph.facebook.com/v24.0/permissao*' => Http::response(['error' => ['code' => 10, 'message' => 'Permission denied']], 403),
    ]);
    $graph = app(MetaGraph::class);

    expect(fn () => $graph->get('/limite', [], 't', 'meta_ads'))->toThrow(fn (LiveApiException $e) => expect($e->retryable)->toBeTrue())
        ->and(fn () => $graph->get('/revogado', [], 't', 'meta_ads'))->toThrow(ConnectorUnavailable::class, 'Reconecte')
        ->and(fn () => $graph->get('/permissao', [], 't', 'meta_ads'))->toThrow(fn (LiveApiException $e) => expect($e->retryable)->toBeFalse());
});
