<?php

declare(strict_types=1);

use App\Models\ConnectCustomer;
use App\Models\IntegrationConnection;
use App\Models\Post;
use App\Models\Project;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/*
| Delta Connect (ADR 0032): merchant, customers com token próprio, isolamento por projeto no
| banco, métricas síncronas e assíncronas, e a sessão hospedada de conexão.
*/

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('SaaS Aurora');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->merchant = (string) $this->actingAs($this->owner)->postJson('/api/api-tokens', ['name' => 'Connect', 'scopes' => ['connect']], $this->headers)->assertCreated()->json('token');
});

/** Chamada à API do Connect como o SaaS do merchant (sem sessão de navegador). */
function connect(string $method, string $uri, array $body = [], ?string $customerToken = null, ?string $merchant = null)
{
    auth()->forgetGuards();
    security()->clear();
    $headers = ['Authorization' => 'Bearer '.($merchant ?? test()->merchant)];
    if ($customerToken !== null) {
        $headers['X-Customer-Token'] = $customerToken;
    }

    return test()->json($method, "/api/connect/v1{$uri}", $body, $headers);
}

/** @return array{0: string, 1: string} [id, token] */
function newCustomer(string $name, ?string $externalId = null): array
{
    $response = connect('POST', '/customers', ['name' => $name, 'external_id' => $externalId, 'niche' => 'ecommerce'])->assertCreated();

    return [(string) $response->json('data.id'), (string) $response->json('customer_token')];
}

it('cria customers com token mostrado uma única vez e permite rotacionar e revogar', function () {
    [$id, $token] = newCustomer('Loja Boreal', 'cli-42');
    expect($token)->toMatch('/^dct_[A-Za-z0-9]{40}$/');

    $listed = connect('GET', '/customers')->assertOk();
    expect($listed->json('data.0.external_id'))->toBe('cli-42')->and($listed->getContent())->not->toContain($token)
        ->and($listed->json('data.0.token_prefix'))->toBe(substr($token, 0, 12));
    connect('POST', '/customers', ['name' => 'Outra', 'external_id' => 'cli-42'])->assertUnprocessable()->assertJsonValidationErrors('external_id');

    connect('GET', '/customer', customerToken: $token)->assertOk()->assertJsonPath('data.name', 'Loja Boreal');
    $new = (string) connect('POST', "/customers/{$id}/token")->assertOk()->json('customer_token');
    connect('GET', '/customer', customerToken: $token)->assertUnauthorized();
    connect('GET', '/customer', customerToken: $new)->assertOk();

    connect('DELETE', "/customers/{$id}")->assertNoContent();
    connect('GET', '/customer', customerToken: $new)->assertUnauthorized();
});

it('isola cada customer no próprio projeto, no banco (leitura e escrita)', function () {
    [, $tokenA] = newCustomer('Cliente A');
    [$idB] = newCustomer('Cliente B');
    $projects = security()->run($this->tenant->id, null, fn () => Project::query()->orderBy('name')->pluck('id', 'name')->all());
    security()->clear();

    // Com o customer A no contexto, o banco só mostra o projeto A, mesmo numa consulta "sem filtro".
    $seen = security()->run($this->tenant->id, null, function () use ($projects) {
        app(TenantContext::class)->setCustomerProject($projects['Cliente A']);

        return [Project::query()->pluck('name')->all(), DB::table('connect_customers')->count()];
    });
    security()->clear();
    expect($seen)->toBe([['Cliente A'], 1]);

    // E não grava no projeto B.
    expect(fn () => security()->run($this->tenant->id, null, function () use ($projects) {
        app(TenantContext::class)->setCustomerProject($projects['Cliente A']);
        DB::transaction(fn () => Post::query()->create(['project_id' => $projects['Cliente B'], 'caption' => 'invasão'])); // savepoint
    }))->toThrow(QueryException::class);
    security()->clear();

    connect('GET', "/customers/{$idB}", customerToken: $tokenA)->assertOk(); // rota de merchant: o customer token não muda nada nela
    connect('GET', '/customer', customerToken: $tokenA)->assertJsonPath('data.name', 'Cliente A');
});

it('conecta contas pela sessão hospedada, sem login, e já liga ao projeto do customer', function () {
    Http::fake();
    [$id, $token] = newCustomer('Loja Boreal', 'cli-7');
    $session = connect('POST', '/customer-integrations/session', ['customer_id' => $id, 'platforms' => ['meta_ads', 'ga4'], 'return_url' => 'https://app.saas.test/voltar'])->assertCreated()->json('data');
    $sessionToken = basename($session['url']);
    expect($session['url'])->toContain('/conectar/')->and($session['platforms'])->toBe(['meta_ads', 'ga4']);

    auth()->forgetGuards();
    security()->clear();
    $page = $this->getJson("/api/public/connect/{$sessionToken}")->assertOk()->json('data');
    expect($page['customer']['name'])->toBe('Loja Boreal')->and(collect($page['platforms'])->pluck('key')->all())->toBe(['meta_ads', 'ga4'])
        ->and($page['platforms'][0]['modes'])->toContain('sandbox');

    // Plataforma fora da sessão: recusada.
    $this->get('/oauth/instagram/start?'.http_build_query(['connect_session' => $sessionToken, 'mode' => 'sandbox', 'flow' => 'flow_'.str_repeat('c', 20), 'return' => 'popup']))
        ->assertStatus(400)->assertSee('não foi liberada', false);

    $start = $this->get('/oauth/meta_ads/start?'.http_build_query(['connect_session' => $sessionToken, 'mode' => 'sandbox', 'flow' => 'flow_'.str_repeat('d', 20), 'return' => 'popup']))->assertRedirect();
    parse_str((string) parse_url((string) $start->headers->get('Location'), PHP_URL_QUERY), $query);
    $this->get('/oauth/meta_ads/callback?'.http_build_query(['state' => $query['state'], 'code' => 'demo_1']))->assertOk()->assertSee('"status":"success"', false);

    $integrations = connect('GET', '/customer', customerToken: $token)->assertOk()->json('data.integrations');
    expect($integrations)->toHaveCount(1)->and($integrations[0]['provider'])->toBe('meta_ads')->and($integrations[0]['mode'])->toBe('sandbox');
    expect(security()->run($this->tenant->id, null, fn () => IntegrationConnection::query()->value('connected_by')))->toBeNull();

    // Link vencido.
    security()->run($this->tenant->id, null, fn () => DB::table('connect_sessions')->update(['expires_at' => now()->subMinute()]));
    security()->clear();
    $this->get('/oauth/ga4/start?'.http_build_query(['connect_session' => $sessionToken, 'mode' => 'sandbox', 'flow' => 'flow_'.str_repeat('e', 20), 'return' => 'popup']))
        ->assertStatus(400)->assertSee('expirou', false);
});

it('entrega métricas na hora e de forma assíncrona pelo webhook assinado', function () {
    $received = [];
    Http::fake(['hooks.saas.test/*' => function (Request $r) use (&$received) {
        $received[] = json_decode($r->body(), true);

        return Http::response('ok', 200);
    }]);
    $this->actingAs($this->owner)->postJson('/api/webhooks', ['url' => 'https://hooks.saas.test/delta', 'events' => ['connect.metrics_ready']], $this->headers)->assertCreated();

    [$id, $token] = newCustomer('Loja Boreal', 'cli-9');
    $project = security()->run($this->tenant->id, null, fn () => ConnectCustomer::query()->findOrFail($id)->project_id);
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    security()->run($this->tenant->id, $this->owner->id, fn () => Project::query()->findOrFail($project)->accounts()->sync([$meta->accounts->firstOrFail()->id]));
    security()->clear();

    $catalog = connect('GET', '/metrics', customerToken: $token)->assertOk()->json('data');
    expect(collect($catalog)->pluck('reference_key'))->toContain('meta_ads:spend')->not->toContain('ga4:sessions');

    $body = ['metrics' => ['meta_ads:spend', 'meta_ads:cpa'], 'start' => now()->subDays(8)->toDateString(), 'end' => now()->subDay()->toDateString(), 'compare' => 'previous_period'];
    $sync = connect('POST', '/metrics/get-data', $body, $token)->assertOk()->json('data.metrics');
    expect($sync[0]['key'])->toBe('meta_ads:spend')->and($sync[0]['value'])->toBeGreaterThan(0);

    $async = connect('POST', '/metrics/get-data-async', $body, $token)->assertAccepted()->json('data');
    expect($received)->toHaveCount(1)
        ->and($received[0]['event'])->toBe('connect.metrics_ready')
        ->and($received[0]['data']['request_id'])->toBe($async['request_id'])
        ->and($received[0]['data']['external_id'])->toBe('cli-9')
        ->and($received[0]['data']['data']['metrics'][0]['value'])->toEqual($sync[0]['value']);
});

it('exige o escopo connect, o customer token e o recurso de API no plano', function () {
    [, $token] = newCustomer('Loja');
    $other = (string) $this->actingAs($this->owner)->postJson('/api/api-tokens', ['name' => 'BI', 'scopes' => ['projects:read']], $this->headers)->json('token');

    connect('GET', '/customers', merchant: $other)->assertForbidden();
    connect('GET', '/customer')->assertUnauthorized();
    connect('GET', '/customer', customerToken: 'dct_'.str_repeat('x', 40))->assertUnauthorized();

    Artisan::call('billing:plan', ['tenant' => $this->tenant->id, 'plan' => 'essencial', '--status' => 'active']);
    connect('GET', '/customer', customerToken: $token)->assertStatus(402);
});
