<?php

declare(strict_types=1);

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\ConnectorUnavailable;
use App\Domain\Integrations\DiscoveredAccount;
use App\Domain\Integrations\Live\TikTokAdsConnector;
use App\Domain\Integrations\OAuth\Apps\AppCredentials;
use App\Domain\Integrations\OAuth\Apps\AppVendor;
use App\Domain\Integrations\OAuth\Apps\PlatformApps;
use App\Domain\Integrations\OAuth\LinkedInOAuth;
use App\Domain\Integrations\OAuth\OAuthException;
use App\Domain\Integrations\OAuth\OAuthTokens;
use App\Domain\Integrations\OAuth\TikTokOAuth;
use App\Models\IntegrationAccount;
use App\Models\IntegrationConnection;
use App\Models\Project;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

/*
| TikTok Ads e LinkedIn Ads (ADR 0024): catálogo, demonstração, coletores reais e login.
*/

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Loja Boreal', 'niche' => 'ecommerce']));
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->d1 = ConnectionManager::yesterday()->subDay();
    $this->d2 = ConnectionManager::yesterday();
    config([
        'services.tiktok.client_id' => '7300000001', 'services.tiktok.client_secret' => 'segredo-tiktok',
        'services.linkedin.client_id' => '86abcdefgh', 'services.linkedin.client_secret' => 'segredo-linkedin',
    ]);
});

function adsLive(string $provider, string $externalId, OAuthTokens $tokens): IntegrationConnection
{
    $t = test();
    $connection = security()->run($t->tenant->id, $t->owner->id, function () use ($t, $provider, $externalId, $tokens): IntegrationConnection {
        $connection = app(ConnectionManager::class)->connectLive($provider, $tokens, [new DiscoveredAccount($externalId, 'Conta', 'ad_account')], $t->owner->id);
        $t->project->accounts()->sync($connection->accounts()->pluck('id')->all());

        return $connection;
    });
    security()->clear();

    return $connection;
}

function adsValues(array $metrics, CarbonImmutable $start, CarbonImmutable $end): array
{
    $t = test();

    return collect($t->actingAs($t->owner)->postJson("/api/projects/{$t->project->id}/metrics/query", [
        'start' => $start->toDateString(), 'end' => $end->toDateString(), 'compare' => 'none', 'metrics' => $metrics,
    ], $t->headers)->assertOk()->json('data.metrics'))->pluck('value', 'key')->all();
}

function tiktokRow(CarbonImmutable $day, array $metrics): array
{
    return ['dimensions' => ['stat_time_day' => $day->toDateString().' 00:00:00'], 'metrics' => array_map('strval', $metrics)];
}

it('oferece TikTok Ads e LinkedIn Ads em demonstração, com números coerentes', function () {
    foreach (['tiktok_ads', 'linkedin_ads'] as $provider) {
        $this->actingAs($this->owner)->postJson('/api/connections', ['provider' => $provider, 'mode' => 'sandbox'], $this->headers)->assertCreated();
    }
    $ids = security()->run($this->tenant->id, null, fn () => IntegrationConnection::query()->with('accounts')->get()->flatMap->accounts->pluck('id')->all());
    security()->clear();
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => $ids], $this->headers)->assertOk();

    $v = adsValues(['tiktok_ads:cpm', 'tiktok_ads:frequency', 'tiktok_ads:completion_rate', 'linkedin_ads:cpm', 'linkedin_ads:cpl', 'linkedin_ads:ctr'], $this->d2->subDays(29), $this->d2);

    expect($v['tiktok_ads:cpm'])->toBeGreaterThan(5)->toBeLessThan(30)
        ->and($v['tiktok_ads:frequency'])->toBeGreaterThan(1)
        ->and($v['tiktok_ads:completion_rate'])->toBeGreaterThan(0)->toBeLessThan(30)
        ->and($v['linkedin_ads:cpm'])->toBeGreaterThan($v['tiktok_ads:cpm']) // B2B é mais caro
        ->and($v['linkedin_ads:cpl'])->toBeGreaterThan(0)
        ->and($v['linkedin_ads:ctr'])->toBeLessThan(2);

    $providers = collect($this->actingAs($this->owner)->getJson('/api/providers', $this->headers)->json('data'))->pluck('app_vendor', 'key');
    expect($providers['tiktok_ads'])->toBe('tiktok')->and($providers['linkedin_ads'])->toBe('linkedin');
});

it('coleta o TikTok Ads por dia e o alcance do período sem somar os dias', function () {
    Http::fake(['business-api.tiktok.com/open_api/v1.3/report/integrated/get/*' => function (Request $r) {
        if ($r['dimensions'] === '["advertiser_id"]') {
            return Http::response(['code' => 0, 'data' => ['list' => [['dimensions' => ['advertiser_id' => '7012'], 'metrics' => ['reach' => '30000']]], 'page_info' => ['total_page' => 1]]]);
        }

        return Http::response(['code' => 0, 'data' => ['page_info' => ['total_page' => 1], 'list' => [
            tiktokRow($this->d1, ['spend' => 100.5, 'impressions' => 20000, 'reach' => 15000, 'clicks' => 200, 'video_play_actions' => 8000, 'video_views_p100' => 800, 'conversion' => 10]),
            tiktokRow($this->d2, ['spend' => 99.5, 'impressions' => 30000, 'reach' => 20000, 'clicks' => 300, 'video_play_actions' => 12000, 'video_views_p100' => 1600, 'conversion' => 15]),
        ]]]);
    }]);

    adsLive('tiktok_ads', '7012', new OAuthTokens('tt-token'));
    $v = adsValues(['tiktok_ads:spend', 'tiktok_ads:ctr', 'tiktok_ads:cpa', 'tiktok_ads:completion_rate', 'tiktok_ads:reach', 'tiktok_ads:frequency'], $this->d1, $this->d2);

    expect($v['tiktok_ads:spend'])->toEqual(200)
        ->and($v['tiktok_ads:ctr'])->toEqual(1.0)
        ->and($v['tiktok_ads:cpa'])->toEqual(8.0)
        ->and($v['tiktok_ads:completion_rate'])->toEqual(12.0)
        ->and($v['tiktok_ads:reach'])->toEqual(30000) // do período, não 15 000 + 20 000
        ->and(round($v['tiktok_ads:frequency'], 2))->toEqual(1.67);

    Http::assertSent(fn (Request $r) => $r->hasHeader('Access-Token', 'tt-token') && $r['advertiser_id'] === '7012'
        && $r['data_level'] === 'AUCTION_ADVERTISER' && $r['dimensions'] === '["stat_time_day"]' && ! str_contains($r->url(), 'tt-token'));
});

it('pede nova autorização quando o TikTok diz que o token foi revogado', function () {
    Http::fake(['business-api.tiktok.com/*' => Http::response(['code' => 40105, 'message' => 'Access token is incorrect or has been revoked.'])]);

    $connection = adsLive('tiktok_ads', '7012', new OAuthTokens('tt-token'));
    $account = security()->run($this->tenant->id, null, fn () => IntegrationAccount::query()->where('connection_id', $connection->id)->sole());

    security()->run($this->tenant->id, null, fn () => iterator_to_array(app(TikTokAdsConnector::class)->fetchDaily($account, $this->d1, $this->d2)));
})->throws(ConnectorUnavailable::class);

it('coleta o LinkedIn Ads pelo adAnalytics, com parâmetros Rest.li sem codificar', function () {
    $day = fn (CarbonImmutable $d) => ['start' => ['year' => $d->year, 'month' => $d->month, 'day' => $d->day], 'end' => ['year' => $d->year, 'month' => $d->month, 'day' => $d->day]];
    Http::fake(['api.linkedin.com/rest/adAnalytics*' => Http::response(['elements' => [
        ['dateRange' => $day($this->d1), 'costInLocalCurrency' => '300.00', 'impressions' => 10000, 'clicks' => 50, 'totalEngagements' => 80, 'oneClickLeads' => 6, 'externalWebsiteConversions' => 2],
        ['dateRange' => $day($this->d2), 'costInLocalCurrency' => '200.00', 'impressions' => 15000, 'clicks' => 75, 'totalEngagements' => 120, 'oneClickLeads' => 4, 'externalWebsiteConversions' => 3],
    ]])]);

    adsLive('linkedin_ads', '507', new OAuthTokens('li-token', null, CarbonImmutable::now()->addDays(50)));
    $v = adsValues(['linkedin_ads:spend', 'linkedin_ads:ctr', 'linkedin_ads:cpl', 'linkedin_ads:cpa', 'linkedin_ads:engagement_rate'], $this->d1, $this->d2);

    expect($v['linkedin_ads:spend'])->toEqual(500)
        ->and($v['linkedin_ads:ctr'])->toEqual(0.5)
        ->and($v['linkedin_ads:cpl'])->toEqual(50.0)
        ->and($v['linkedin_ads:cpa'])->toEqual(100.0)
        ->and($v['linkedin_ads:engagement_rate'])->toEqual(0.8);

    Http::assertSent(fn (Request $r) => str_contains($r->url(), 'accounts=List(urn%3Ali%3AsponsoredAccount%3A507)')
        && str_contains($r->url(), 'dateRange=(start:(year:') && str_contains($r->url(), 'timeGranularity=DAILY')
        && $r->hasHeader('X-Restli-Protocol-Version', '2.0.0') && $r->hasHeader('LinkedIn-Version') && $r->hasHeader('Authorization', 'Bearer li-token'));
});

it('renova o token do LinkedIn com o refresh token e guarda o refresh token novo', function () {
    Http::fake([
        'www.linkedin.com/oauth/v2/accessToken' => Http::response(['access_token' => 'li-novo', 'expires_in' => 5184000, 'refresh_token' => 'rt-novo', 'refresh_token_expires_in' => 31000000]),
        'api.linkedin.com/rest/adAnalytics*' => Http::response(['elements' => []]),
    ]);

    $connection = adsLive('linkedin_ads', '507', new OAuthTokens('li-velho', 'rt-velho', CarbonImmutable::now()->subMinute()));

    $credentials = security()->run($this->tenant->id, null, fn () => IntegrationConnection::query()->findOrFail($connection->id)->credentials);
    expect($credentials['access_token'])->toBe('li-novo')->and($credentials['refresh_token'])->toBe('rt-novo');
    Http::assertSent(fn (Request $r) => $r->url() === LinkedInOAuth::TOKEN_URL && $r['grant_type'] === 'refresh_token' && $r['refresh_token'] === 'rt-velho' && $r['client_id'] === '86abcdefgh');
    Http::assertSent(fn (Request $r) => str_contains($r->url(), 'adAnalytics') && $r->hasHeader('Authorization', 'Bearer li-novo'));
});

it('marca a conexão do LinkedIn como expirada quando o token vence sem refresh token', function () {
    Http::fake();
    $connection = adsLive('linkedin_ads', '507', new OAuthTokens('li-velho', null, CarbonImmutable::now()->subMinute()));

    $fresh = security()->run($this->tenant->id, null, fn () => IntegrationConnection::query()->findOrFail($connection->id));
    expect($fresh->status)->toBe('expired');
    Http::assertNothingSent();
});

it('conecta o TikTok pelo retorno com auth_code e descobre os anunciantes', function () {
    Http::fake([
        'business-api.tiktok.com/open_api/v1.3/oauth2/access_token/' => Http::response(['code' => 0, 'data' => ['access_token' => 'tt-longo', 'scope' => [4, 5], 'advertiser_ids' => ['7012']]]),
        'business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/*' => Http::response(['code' => 0, 'data' => ['list' => [['advertiser_id' => '7012', 'advertiser_name' => 'Loja Boreal TikTok']]]]),
        'business-api.tiktok.com/open_api/v1.3/report/*' => Http::response(['code' => 0, 'data' => ['list' => [], 'page_info' => ['total_page' => 1]]]),
    ]);

    $start = $this->actingAs($this->owner)->get('/oauth/tiktok_ads/start?'.http_build_query(['tenant_id' => $this->tenant->id, 'mode' => 'live', 'flow' => 'flow_'.str_repeat('t', 20), 'return' => 'popup']));
    $authorize = (string) $start->assertRedirect()->headers->get('Location');
    parse_str((string) parse_url($authorize, PHP_URL_QUERY), $query);

    expect($authorize)->toStartWith('https://business-api.tiktok.com/portal/auth?')
        ->and($query['app_id'])->toBe('7300000001')
        ->and($query['redirect_uri'])->toBe('http://localhost:4300/oauth/tiktok_ads/callback');

    $this->actingAs($this->owner)->get('/oauth/tiktok_ads/callback?'.http_build_query(['state' => $query['state'], 'auth_code' => 'codigo-tiktok']))
        ->assertOk()->assertSee('"status":"success"', false);

    $connection = security()->run($this->tenant->id, null, fn () => IntegrationConnection::query()->with('accounts')->sole());
    expect($connection->provider)->toBe('tiktok_ads')
        ->and($connection->accounts->pluck('name', 'external_id')->all())->toBe(['7012' => 'Loja Boreal TikTok'])
        ->and($connection->credentials['access_token'] ?? null)->toBe('tt-longo')
        ->and($connection->credentials)->toHaveKey('expires_at', null); // token de anunciante não expira

    Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/oauth2/access_token/') && $r['auth_code'] === 'codigo-tiktok' && $r['secret'] === 'segredo-tiktok');
});

it('explica quando o TikTok recusa a autorização', function () {
    Http::fake(['business-api.tiktok.com/*' => Http::response(['code' => 40001, 'message' => 'No permission'])]);

    security()->run($this->tenant->id, $this->owner->id, fn () => app(TikTokOAuth::class)->exchange('tiktok_ads', 'x', 'http://localhost', null));
})->throws(OAuthException::class);

it('descobre as contas de anúncio do LinkedIn com nome e moeda', function () {
    Http::fake([
        'api.linkedin.com/rest/adAccountUsers*' => Http::response(['elements' => [['account' => 'urn:li:sponsoredAccount:507', 'role' => 'ACCOUNT_MANAGER'], ['account' => 'lixo']]]),
        'api.linkedin.com/rest/adAccounts/507' => Http::response(['id' => 507, 'name' => 'Boreal B2B', 'currency' => 'BRL']),
    ]);

    $accounts = security()->run($this->tenant->id, $this->owner->id, fn () => app(LinkedInOAuth::class)->discoverAccounts('linkedin_ads', new OAuthTokens('li-token')));

    expect($accounts)->toHaveCount(1)
        ->and($accounts[0]->externalId)->toBe('507')->and($accounts[0]->name)->toBe('Boreal B2B')->and($accounts[0]->currency)->toBe('BRL');
    Http::assertSent(fn (Request $r) => str_contains($r->url(), 'q=authenticatedUser') && $r->hasHeader('X-Restli-Protocol-Version', '2.0.0'));
});

it('confere o app do LinkedIn com um código inválido de propósito', function () {
    Http::fake(['www.linkedin.com/oauth/v2/accessToken' => Http::sequence()
        ->push(['error' => 'invalid_client', 'error_description' => 'Client authentication failed'], 401)
        ->push(['error' => 'invalid_request', 'error_description' => 'Unable to retrieve access token: authorization code not found'], 400)]);
    $oauth = app(LinkedInOAuth::class);
    $app = new AppCredentials('86abcdefgh', 'segredo', null, 'agency');

    expect($oauth->verifyApp($app)->status)->toBe('invalid')
        ->and($oauth->verifyApp($app)->status)->toBe('verified');
});

it('aceita cadastrar os apps do TikTok e do LinkedIn, com o formato de ID de cada um', function () {
    Http::fake(['www.linkedin.com/*' => Http::response(['error' => 'invalid_request'], 400)]);

    $this->actingAs($this->owner)->putJson('/api/platform-apps/tiktok', ['client_id' => 'abc', 'client_secret' => 'segredo-tiktok'], $this->headers)
        ->assertUnprocessable()->assertJsonValidationErrors(['client_id' => 'só números']);
    $this->actingAs($this->owner)->putJson('/api/platform-apps/tiktok', ['client_id' => '7300000001', 'client_secret' => 'segredo-tiktok'], $this->headers)
        ->assertOk()->assertJsonPath('verification.status', 'unreachable')->assertJsonPath('data.status', 'unverified');
    $this->actingAs($this->owner)->putJson('/api/platform-apps/linkedin', ['client_id' => '86abcdefgh', 'client_secret' => 'segredo-linkedin', 'developer_token' => 'x'], $this->headers)
        ->assertUnprocessable()->assertJsonValidationErrors(['developer_token']);
    $this->actingAs($this->owner)->putJson('/api/platform-apps/linkedin', ['client_id' => '86abcdefgh', 'client_secret' => 'segredo-linkedin'], $this->headers)
        ->assertOk()->assertJsonPath('verification.status', 'verified')->assertJsonPath('data.status', 'verified');

    expect(security()->run($this->tenant->id, null, fn () => app(PlatformApps::class)->credentials(AppVendor::Linkedin)?->source))->toBe('agency');
});
