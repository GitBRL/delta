<?php

declare(strict_types=1);

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\DiscoveredAccount;
use App\Domain\Integrations\OAuth\GoogleOAuth;
use App\Domain\Integrations\OAuth\OAuthTokens;
use App\Models\IntegrationConnection;
use App\Models\Project;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Clínica Sorriso', 'niche' => 'negocio_local']));
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->d1 = ConnectionManager::yesterday()->subDay();
    $this->d2 = ConnectionManager::yesterday();
    config(['services.google.client_id' => 'c.apps.googleusercontent.com', 'services.google.client_secret' => 'segredo']);
});

function googleLive(string $provider, string $externalId, string $kind): void
{
    $t = test();
    security()->run($t->tenant->id, $t->owner->id, function () use ($t, $provider, $externalId, $kind): void {
        $connection = app(ConnectionManager::class)->connectLive($provider, new OAuthTokens('ya29.ok', '1//r', CarbonImmutable::now()->addHour()), [new DiscoveredAccount($externalId, 'Conta', $kind)], $t->owner->id);
        $t->project->accounts()->sync($connection->accounts()->pluck('id')->all());
    });
    security()->clear();
}

function channelValues(array $metrics, CarbonImmutable $start, CarbonImmutable $end): array
{
    $t = test();

    return collect($t->actingAs($t->owner)->postJson("/api/projects/{$t->project->id}/metrics/query", [
        'start' => $start->toDateString(), 'end' => $end->toDateString(), 'compare' => 'none', 'metrics' => $metrics,
    ], $t->headers)->assertOk()->json('data.metrics'))->pluck('value', 'key')->all();
}

it('oferece os três canais novos em demonstração, com dados coerentes', function () {
    foreach (['search_console', 'youtube', 'google_business'] as $provider) {
        $this->actingAs($this->owner)->postJson('/api/connections', ['provider' => $provider, 'mode' => 'sandbox'], $this->headers)->assertCreated();
    }
    $ids = security()->run($this->tenant->id, null, fn () => IntegrationConnection::query()->with('accounts')->get()->flatMap->accounts->pluck('id')->all());
    security()->clear();
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => $ids], $this->headers)->assertOk();

    $v = channelValues(['search_console:position', 'search_console:ctr', 'youtube:net_subscribers', 'youtube:subscribers', 'google_business:actions', 'google_business:action_rate'], $this->d2->subDays(29), $this->d2);

    expect($v['search_console:position'])->toBeGreaterThan(1)->toBeLessThan(40)
        ->and($v['search_console:ctr'])->toBeGreaterThan(0)->toBeLessThan(15)
        ->and($v['youtube:subscribers'])->toBeGreaterThan(1000)
        ->and($v['google_business:actions'])->toBeGreaterThan(0)
        ->and($v['google_business:action_rate'])->toBeLessThan(10);

    $providers = collect($this->actingAs($this->owner)->getJson('/api/providers', $this->headers)->json('data'))->pluck('app_vendor', 'key');
    expect($providers->only(['search_console', 'youtube', 'google_business'])->unique()->values()->all())->toBe(['google']);
});

it('coleta o Search Console com a posição média ponderada pelas impressões', function () {
    Http::fake(['www.googleapis.com/webmasters/v3/sites/*' => Http::response(['rows' => [
        ['keys' => [$this->d1->toDateString()], 'clicks' => 30, 'impressions' => 1000, 'ctr' => 0.03, 'position' => 4.0],
        ['keys' => [$this->d2->toDateString()], 'clicks' => 10, 'impressions' => 3000, 'ctr' => 0.0033, 'position' => 12.0],
    ]])]);

    googleLive('search_console', 'sc-domain:sorriso.com.br', 'site');
    $v = channelValues(['search_console:clicks', 'search_console:position', 'search_console:ctr'], $this->d1, $this->d2);

    expect($v['search_console:clicks'])->toEqual(40)
        ->and($v['search_console:position'])->toEqual(10.0) // (4×1000 + 12×3000) ÷ 4000
        ->and($v['search_console:ctr'])->toEqual(1.0);
    Http::assertSent(fn (Request $r) => str_contains($r->url(), rawurlencode('sc-domain:sorriso.com.br')) && $r['dimensions'] === ['date']);
});

it('coleta YouTube Analytics e o total de inscritos', function () {
    Http::fake([
        'youtubeanalytics.googleapis.com/*' => Http::response([
            'columnHeaders' => array_map(fn ($n) => ['name' => $n], ['day', 'views', 'estimatedMinutesWatched', 'subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares']),
            'rows' => [[$this->d1->toDateString(), 500, 1500, 12, 2, 40, 5, 3], [$this->d2->toDateString(), 700, 2100, 18, 3, 60, 8, 4]],
        ]),
        'www.googleapis.com/youtube/v3/channels*' => Http::response(['items' => [['statistics' => ['subscriberCount' => '25400']]]]),
    ]);

    googleLive('youtube', 'UC123', 'channel');
    $v = channelValues(['youtube:views', 'youtube:net_subscribers', 'youtube:subscribers', 'youtube:avg_view_minutes'], $this->d1, $this->d2);

    expect($v['youtube:views'])->toEqual(1200)->and($v['youtube:net_subscribers'])->toEqual(25)
        ->and($v['youtube:subscribers'])->toEqual(25400)->and($v['youtube:avg_view_minutes'])->toEqual(3.0);
});

it('coleta o Perfil da Empresa somando Busca e Maps', function () {
    $point = fn (CarbonImmutable $d, ?string $v) => array_filter(['date' => ['year' => $d->year, 'month' => $d->month, 'day' => $d->day], 'value' => $v], fn ($x) => $x !== null);
    Http::fake(['businessprofileperformance.googleapis.com/*' => Http::response(['multiDailyMetricTimeSeries' => [['dailyMetricTimeSeries' => [
        ['dailyMetric' => 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'timeSeries' => ['datedValues' => [$point($this->d1, '100'), $point($this->d2, '120')]]],
        ['dailyMetric' => 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'timeSeries' => ['datedValues' => [$point($this->d1, '50'), $point($this->d2, null)]]],
        ['dailyMetric' => 'CALL_CLICKS', 'timeSeries' => ['datedValues' => [$point($this->d1, '3'), $point($this->d2, '4')]]],
    ]]]])]);

    googleLive('google_business', 'locations/987', 'location');
    $v = channelValues(['google_business:impressions', 'google_business:calls', 'google_business:actions'], $this->d1, $this->d2);

    expect($v['google_business:impressions'])->toEqual(270)->and($v['google_business:calls'])->toEqual(7)->and($v['google_business:actions'])->toEqual(7);
    Http::assertSent(fn (Request $r) => str_contains($r->url(), 'locations/987:fetchMultiDailyMetricsTimeSeries') && str_contains($r->url(), 'dailyMetrics=CALL_CLICKS'));
});

it('descobre sites, canais e unidades na autorização do Google', function () {
    Http::fake([
        'www.googleapis.com/webmasters/v3/sites' => Http::response(['siteEntry' => [['siteUrl' => 'sc-domain:a.com', 'permissionLevel' => 'siteOwner'], ['siteUrl' => 'https://b.com/', 'permissionLevel' => 'siteUnverifiedUser']]]),
        'www.googleapis.com/youtube/v3/channels*' => Http::response(['items' => [['id' => 'UC1', 'snippet' => ['title' => 'Canal Sorriso']]]]),
        'mybusinessaccountmanagement.googleapis.com/*' => Http::response(['accounts' => [['name' => 'accounts/1']]]),
        'mybusinessbusinessinformation.googleapis.com/*' => Http::response(['locations' => [['name' => 'locations/9', 'title' => 'Clínica Centro']]]),
    ]);
    $oauth = app(GoogleOAuth::class);
    $tokens = new OAuthTokens('ya29.x');

    expect(array_map(fn ($a) => $a->externalId, $oauth->discoverAccounts('search_console', $tokens)))->toBe(['sc-domain:a.com'])
        ->and($oauth->discoverAccounts('youtube', $tokens)[0]->name)->toBe('Canal Sorriso')
        ->and($oauth->discoverAccounts('google_business', $tokens)[0]->externalId)->toBe('locations/9');
});
