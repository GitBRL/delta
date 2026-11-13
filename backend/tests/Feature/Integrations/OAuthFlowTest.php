<?php

declare(strict_types=1);

use App\Models\IntegrationConnection;
use App\Support\Tenancy\TenantRole;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência A');
    security()->clear();
    $this->flow = 'flow_'.str_repeat('a', 20);
});

/** Abre o fluxo e devolve a URL de autorização para onde o pop-up foi enviado. */
function startOAuth(string $provider, string $mode = 'sandbox', string $return = 'popup', $user = null, ?string $tenantId = null): string
{
    $t = test();
    $response = $t->actingAs($user ?? $t->owner)->get("/oauth/{$provider}/start?".http_build_query([
        'tenant_id' => $tenantId ?? $t->tenant->id, 'mode' => $mode, 'flow' => $t->flow, 'return' => $return,
    ]));

    $response->assertRedirect();

    return (string) $response->headers->get('Location');
}

function stateOf(string $url): string
{
    parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

    return (string) $query['state'];
}

function connections(): int
{
    $t = test();

    return security()->run($t->tenant->id, null, fn () => IntegrationConnection::query()->count());
}

it('percorre a jornada de demonstração: pop-up, tela de autorização e retorno conectado', function () {
    $authorize = startOAuth('meta_ads');
    expect($authorize)->toStartWith('/oauth/meta_ads/demo?state=');

    $this->actingAs($this->owner)->get($authorize)
        ->assertOk()
        ->assertSee('Modo demonstração')
        ->assertSee('Conectar Meta Ads ao Delta');

    $response = $this->actingAs($this->owner)->get('/oauth/meta_ads/callback?'.http_build_query(['state' => stateOf($authorize), 'code' => 'demo_abc']))
        ->assertOk()
        ->assertSee('Meta Ads conectado')
        ->assertSee('"type":"delta:oauth"', false)
        ->assertSee('"flow":"'.$this->flow.'"', false)
        ->assertSee('"status":"success"', false)
        ->assertSee('BroadcastChannel', false);

    $connection = security()->run($this->tenant->id, null, fn () => IntegrationConnection::query()->with('accounts')->sole());

    expect($connection->mode)->toBe('sandbox')
        ->and($connection->accounts)->toHaveCount(1)
        ->and($response->getContent())->toContain($connection->id);
});

it('protege as páginas do fluxo com CSP de nonce e sem cortar o vínculo do pop-up', function () {
    $authorize = startOAuth('ga4');
    $headers = $this->actingAs($this->owner)->get('/oauth/ga4/callback?'.http_build_query(['state' => stateOf($authorize), 'code' => 'demo_x']))->headers;

    expect($headers->get('Cross-Origin-Opener-Policy'))->toBe('unsafe-none')
        ->and($headers->get('Content-Security-Policy'))->toContain("script-src 'nonce-")->toContain("default-src 'none'")
        ->and($headers->get('Cache-Control'))->toContain('no-store');
});

it('aceita cada state uma única vez', function () {
    $state = stateOf(startOAuth('meta_ads'));
    $callback = '/oauth/meta_ads/callback?'.http_build_query(['state' => $state, 'code' => 'demo_1']);

    $this->actingAs($this->owner)->get($callback)->assertOk();
    $this->actingAs($this->owner)->get($callback)->assertStatus(400)->assertSee('expirou ou já foi usado');

    expect(connections())->toBe(1);
});

it('recusa state expirado', function () {
    $state = stateOf(startOAuth('meta_ads'));
    $this->travel(11)->minutes();

    $this->actingAs($this->owner)->get('/oauth/meta_ads/callback?'.http_build_query(['state' => $state, 'code' => 'demo_1']))
        ->assertStatus(400)->assertSee('expirou');

    expect(connections())->toBe(0);
});

it('recusa state usado por outro usuário, mesmo da mesma agência', function () {
    $state = stateOf(startOAuth('meta_ads'));
    $colleague = addUserToTenant($this->tenant, TenantRole::Admin);
    security()->clear();

    $this->actingAs($colleague)->get('/oauth/meta_ads/callback?'.http_build_query(['state' => $state, 'code' => 'demo_1']))
        ->assertStatus(400)->assertSee('expirou ou já foi usado');

    expect(connections())->toBe(0);
});

it('recusa state de outra plataforma ou adulterado', function () {
    $state = stateOf(startOAuth('meta_ads'));
    [$other] = tenantWithOwner('Agência B');
    security()->clear();
    $forged = $other->id.substr($state, 36);

    $this->actingAs($this->owner)->get('/oauth/ga4/callback?'.http_build_query(['state' => $state, 'code' => 'demo_1']))->assertStatus(400);
    $this->actingAs($this->owner)->get('/oauth/meta_ads/callback?'.http_build_query(['state' => $forged, 'code' => 'demo_1']))
        ->assertStatus(400)->assertSee('não tem acesso');
    $this->actingAs($this->owner)->get('/oauth/meta_ads/callback?state=lixo&code=demo_1')->assertStatus(400)->assertSee('inválido');
});

it('exige sessão ativa no retorno', function () {
    $state = stateOf(startOAuth('meta_ads'));
    auth()->forgetGuards(); // simula sessão expirada: o próximo request chega sem usuário

    $this->get('/oauth/meta_ads/callback?'.http_build_query(['state' => $state, 'code' => 'demo_1']))
        ->assertStatus(400)->assertSee('sessão expirou');
});

it('só deixa a equipe da agência iniciar a conexão', function () {
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    [$other] = tenantWithOwner('Agência B');
    security()->clear();

    $this->actingAs($client)->get('/oauth/meta_ads/start?'.http_build_query(['tenant_id' => $this->tenant->id, 'mode' => 'sandbox', 'flow' => $this->flow]))
        ->assertStatus(400)->assertSee('Só a equipe da agência');

    $this->actingAs($this->owner)->get('/oauth/meta_ads/start?'.http_build_query(['tenant_id' => $other->id, 'mode' => 'sandbox', 'flow' => $this->flow]))
        ->assertStatus(400)->assertSee('não tem acesso');
});

it('trata o cancelamento na tela da plataforma', function () {
    $state = stateOf(startOAuth('instagram'));

    $this->actingAs($this->owner)->get('/oauth/instagram/callback?'.http_build_query(['state' => $state, 'error' => 'access_denied']))
        ->assertOk()->assertSee('Conexão cancelada')->assertSee('"status":"cancelled"', false);

    expect(connections())->toBe(0);
});

it('volta para Integrações quando o navegador bloqueou o pop-up (modo redirect)', function () {
    $state = stateOf(startOAuth('meta_ads', return: 'redirect'));

    $location = (string) $this->actingAs($this->owner)
        ->get('/oauth/meta_ads/callback?'.http_build_query(['state' => $state, 'code' => 'demo_1']))
        ->assertRedirect()
        ->headers->get('Location');

    expect($location)->toStartWith('http://localhost:4300/integracoes?oauth=success&provider=meta_ads&connection_id=');
});

it('avisa que o login real não está configurado e onde configurar', function () {
    $this->actingAs($this->owner)->get('/oauth/meta_ads/start?'.http_build_query(['tenant_id' => $this->tenant->id, 'mode' => 'live', 'flow' => $this->flow]))
        ->assertStatus(400)->assertSee('falta cadastrar o app da Meta')->assertSee('Apps das plataformas');

    $providers = collect($this->actingAs($this->owner)->getJson('/api/providers', ['X-Tenant-Id' => $this->tenant->id])->json('data'))->keyBy('key');

    expect($providers['meta_ads']['available_modes'])->toBe(['sandbox'])
        ->and($providers['google_ads']['live_note'])->toContain('falta cadastrar o app do Google');
});

it('conecta uma conta real da Meta: token de longa duração, contas descobertas e credenciais criptografadas', function () {
    config(['services.meta.client_id' => 'app123', 'services.meta.client_secret' => 'segredo']);
    Http::fake([
        'graph.facebook.com/v24.0/oauth/access_token*' => Http::sequence()
            ->push(['access_token' => 'token-curto', 'expires_in' => 3600])
            ->push(['access_token' => 'token-longo', 'expires_in' => 5184000]),
        'graph.facebook.com/v24.0/me/adaccounts*' => Http::response(['data' => [
            ['account_id' => '111', 'name' => 'Loja Aurora', 'currency' => 'BRL', 'timezone_name' => 'America/Sao_Paulo'],
            ['account_id' => '222', 'name' => 'Loja Boreal', 'currency' => 'BRL'],
        ]]),
        'graph.facebook.com/v24.0/act_*/insights*' => Http::response(['data' => []]), // primeira coleta, logo após conectar
    ]);

    $authorize = startOAuth('meta_ads', 'live');
    parse_str((string) parse_url($authorize, PHP_URL_QUERY), $query);

    expect($authorize)->toStartWith('https://www.facebook.com/v24.0/dialog/oauth?')
        ->and($query['client_id'])->toBe('app123')
        ->and($query['scope'])->toBe('ads_read,business_management')
        ->and($query['redirect_uri'])->toBe('http://localhost:4300/oauth/meta_ads/callback');

    $this->actingAs($this->owner)->get('/oauth/meta_ads/callback?'.http_build_query(['state' => $query['state'], 'code' => 'codigo-real']))
        ->assertOk()->assertSee('"status":"success"', false);

    $connection = security()->run($this->tenant->id, null, fn () => IntegrationConnection::query()->with('accounts')->sole());
    $raw = security()->run($this->tenant->id, null, fn () => (string) DB::table('connections')->value('credentials'));

    expect($connection->mode)->toBe('live')
        ->and($connection->status)->toBe('active')
        ->and($connection->accounts->pluck('external_id')->all())->toBe(['act_111', 'act_222'])
        ->and($connection->credentials['access_token'] ?? null)->toBe('token-longo')
        ->and($connection->credentials['expires_at'] ?? null)->not->toBeNull()
        ->and($raw)->not->toContain('token-longo');

    Http::assertSent(fn ($r) => str_contains($r->url(), 'fb_exchange_token=token-curto'));
    Http::assertSent(fn ($r) => str_contains($r->url(), '/me/adaccounts') && $r->hasHeader('Authorization', 'Bearer token-longo') && ! str_contains($r->url(), 'token-longo'));
});

it('conecta o GA4 com PKCE e refresh token', function () {
    config(['services.google.client_id' => 'cliente.apps.googleusercontent.com', 'services.google.client_secret' => 'segredo']);
    Http::fake([
        'oauth2.googleapis.com/token' => Http::response(['access_token' => 'ya29.acesso', 'refresh_token' => '1//refresh', 'expires_in' => 3599, 'scope' => 'https://www.googleapis.com/auth/analytics.readonly']),
        'analyticsadmin.googleapis.com/*' => Http::response(['accountSummaries' => [
            ['account' => 'accounts/1', 'displayName' => 'Aurora', 'propertySummaries' => [['property' => 'properties/987', 'displayName' => 'Site Aurora']]],
        ]]),
    ]);

    $authorize = startOAuth('ga4', 'live');
    parse_str((string) parse_url($authorize, PHP_URL_QUERY), $query);

    expect($authorize)->toStartWith('https://accounts.google.com/o/oauth2/v2/auth?')
        ->and($query['code_challenge_method'])->toBe('S256')
        ->and($query['access_type'])->toBe('offline');

    $this->actingAs($this->owner)->get('/oauth/ga4/callback?'.http_build_query(['state' => $query['state'], 'code' => 'codigo']))->assertOk();

    Http::assertSent(function ($request) use ($query): bool {
        if (! str_contains($request->url(), 'oauth2.googleapis.com/token')) {
            return false;
        }
        $challenge = rtrim(strtr(base64_encode(hash('sha256', (string) $request['code_verifier'], true)), '+/', '-_'), '=');

        return $challenge === $query['code_challenge'] && $request['grant_type'] === 'authorization_code';
    });

    $connection = security()->run($this->tenant->id, null, fn () => IntegrationConnection::query()->with('accounts')->sole());

    expect($connection->accounts->first()?->external_id)->toBe('properties/987')
        ->and($connection->credentials['refresh_token'] ?? null)->toBe('1//refresh');
});

it('explica quando a plataforma recusa a troca do código', function () {
    config(['services.meta.client_id' => 'app123', 'services.meta.client_secret' => 'segredo']);
    Http::fake(['graph.facebook.com/*' => Http::response(['error' => ['message' => 'invalid code']], 400)]);

    $state = stateOf(startOAuth('meta_ads', 'live'));

    $this->actingAs($this->owner)->get('/oauth/meta_ads/callback?'.http_build_query(['state' => $state, 'code' => 'ruim']))
        ->assertStatus(400)->assertSee('A plataforma recusou');

    expect(connections())->toBe(0);
});

it('ressincroniza conexão real pelo coletor da plataforma', function () {
    config(['services.meta.client_id' => 'app123', 'services.meta.client_secret' => 'segredo']);
    Http::fake([
        'graph.facebook.com/v24.0/oauth/access_token*' => Http::response(['access_token' => 't', 'expires_in' => 5184000]),
        'graph.facebook.com/v24.0/me/adaccounts*' => Http::response(['data' => [['account_id' => '111', 'name' => 'Loja']]]),
        'graph.facebook.com/v24.0/act_111/insights*' => Http::response(['data' => []]),
    ]);
    $this->actingAs($this->owner)->get('/oauth/meta_ads/callback?'.http_build_query(['state' => stateOf(startOAuth('meta_ads', 'live')), 'code' => 'c']))->assertOk();
    $id = security()->run($this->tenant->id, null, fn () => IntegrationConnection::query()->value('id'));
    security()->clear();

    $this->actingAs($this->owner)->postJson("/api/connections/{$id}/sync", [], ['X-Tenant-Id' => $this->tenant->id])->assertAccepted();
    expect(security()->run($this->tenant->id, null, fn () => IntegrationConnection::query()->value('status')))->toBe('active');
});
