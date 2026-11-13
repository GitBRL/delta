<?php

declare(strict_types=1);

use App\Models\AuditLog;
use App\Models\IntegrationConnection;
use App\Models\OAuthApp;
use App\Support\Tenancy\TenantRole;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

const META_ID = '1234567890';
const META_SECRET = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const GOOGLE_ID = 'cliente-teste.apps.googleusercontent.com';
const GOOGLE_SECRET = 'segredo-google-de-teste-yz12';

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência A');
    $this->admin = addUserToTenant($this->tenant, TenantRole::Admin);
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    Http::preventStrayRequests();
});

function fakeMetaVerification(): void
{
    Http::fake([
        'graph.facebook.com/v24.0/oauth/access_token*' => Http::response(['access_token' => META_ID.'|app-token', 'token_type' => 'bearer']),
        'graph.facebook.com/v24.0/'.META_ID.'*' => Http::response(['id' => META_ID, 'name' => 'Delta Reports']),
    ]);
}

function saveApp(string $vendor, array $body, $user = null, ?string $tenantId = null)
{
    $t = test();

    return $t->actingAs($user ?? $t->admin)->putJson("/api/platform-apps/{$vendor}", $body, ['X-Tenant-Id' => $tenantId ?? $t->tenant->id]);
}

/** @return array<string, array<string, mixed>> plataformas por chave, como a agência as vê */
function providersFor(string $tenantId, $user): array
{
    return collect(test()->actingAs($user)->getJson('/api/providers', ['X-Tenant-Id' => $tenantId])->assertOk()->json('data'))
        ->keyBy('key')->all();
}

it('lista Meta, Google, TikTok e LinkedIn sem nada configurado, com os endereços para cadastrar nas plataformas', function () {
    $response = $this->actingAs($this->owner)->getJson('/api/platform-apps', $this->headers)
        ->assertOk()
        ->assertJsonCount(4, 'data')
        ->assertJsonPath('data.0.vendor', 'meta')
        ->assertJsonPath('data.0.status', 'missing')
        ->assertJsonPath('data.0.source', null)
        ->assertJsonPath('data.0.console_url', 'https://developers.facebook.com/apps')
        ->assertJsonPath('data.0.requires_developer_token', false)
        ->assertJsonPath('data.1.vendor', 'google')
        ->assertJsonPath('data.1.requires_developer_token', true)
        ->assertJsonPath('data.1.missing_platforms', ['ga4', 'google_ads', 'search_console', 'youtube', 'google_business', 'google_sheets'])
        ->assertJsonPath('data.2.vendor', 'tiktok')
        ->assertJsonPath('data.2.redirect_uris', ['http://localhost:4300/oauth/tiktok_ads/callback'])
        ->assertJsonPath('data.3.vendor', 'linkedin')
        ->assertJsonPath('data.3.console_url', 'https://www.linkedin.com/developers/apps');

    expect($response->json('data.0.redirect_uris'))->toBe([
        'http://localhost:4300/oauth/meta_ads/callback',
        'http://localhost:4300/oauth/facebook/callback',
        'http://localhost:4300/oauth/instagram/callback',
    ])->and(collect($response->json('data.0.platforms'))->pluck('name')->all())->toBe(['Meta Ads', 'Facebook', 'Instagram']);
});

it('o administrador cadastra o app da Meta e o login real liga só para a agência dele', function () {
    fakeMetaVerification();
    [$other, $otherOwner] = tenantWithOwner('Agência B');
    security()->clear();

    $response = saveApp('meta', ['client_id' => META_ID, 'client_secret' => META_SECRET])
        ->assertOk()
        ->assertJsonPath('verification.status', 'verified')
        ->assertJsonPath('data.status', 'verified')
        ->assertJsonPath('data.source', 'agency')
        ->assertJsonPath('data.client_id', META_ID)
        ->assertJsonPath('data.client_secret_hint', '••••c5d6')
        ->assertJsonPath('data.updated_by', $this->admin->name)
        ->assertJsonPath('data.missing_platforms', []);

    expect($response->json('verification.message'))->toContain('Delta Reports')
        ->and($response->getContent())->not->toContain(META_SECRET);

    // Segredo criptografado no banco e fora da auditoria.
    security()->set($this->tenant->id, $this->owner->id);
    $raw = (string) DB::table('oauth_apps')->value('client_secret');
    $log = AuditLog::query()->where('action', 'oauth_app.created')->sole();
    expect($raw)->not->toContain(META_SECRET)
        ->and(OAuthApp::query()->sole()->client_secret)->toBe(META_SECRET)
        ->and($log->actor_user_id)->toBe($this->admin->id)
        ->and($log->metadata)->toMatchArray(['vendor' => 'meta', 'verification' => 'verified'])
        ->and(json_encode($log->metadata))->not->toContain(META_SECRET);
    security()->clear();

    expect(providersFor($this->tenant->id, $this->owner)['meta_ads']['available_modes'])->toBe(['sandbox', 'live'])
        ->and(providersFor($this->tenant->id, $this->owner)['instagram']['available_modes'])->toBe(['sandbox', 'live'])
        ->and(providersFor($other->id, $otherOwner)['meta_ads']['available_modes'])->toBe(['sandbox']);

    $this->actingAs($otherOwner)->getJson('/api/platform-apps', ['X-Tenant-Id' => $other->id])->assertJsonPath('data.0.status', 'missing');

    $location = (string) $this->actingAs($this->owner)
        ->get('/oauth/meta_ads/start?'.http_build_query(['tenant_id' => $this->tenant->id, 'mode' => 'live', 'flow' => 'flow_'.str_repeat('b', 20)]))
        ->assertRedirect()->headers->get('Location');
    parse_str((string) parse_url($location, PHP_URL_QUERY), $query);

    expect($location)->toStartWith('https://www.facebook.com/v24.0/dialog/oauth?')
        ->and($query['client_id'])->toBe(META_ID);
});

it('usa o app da agência no lugar do servidor, inclusive na troca do código por token', function () {
    config(['services.meta.client_id' => '555555', 'services.meta.client_secret' => 'segredo-do-servidor']);
    Http::fake([
        'graph.facebook.com/v24.0/oauth/access_token*' => Http::sequence()
            ->push(['access_token' => META_ID.'|app-token'])          // verificação
            ->push(['access_token' => 'token-curto', 'expires_in' => 3600])
            ->push(['access_token' => 'token-longo', 'expires_in' => 5184000]),
        'graph.facebook.com/v24.0/'.META_ID.'*' => Http::response(['name' => 'Delta Reports']),
        'graph.facebook.com/v24.0/me/adaccounts*' => Http::response(['data' => [['account_id' => '111', 'name' => 'Loja Aurora']]]),
        'graph.facebook.com/v24.0/act_111/insights*' => Http::response(['data' => []]),
    ]);

    $this->actingAs($this->owner)->getJson('/api/platform-apps', $this->headers)
        ->assertJsonPath('data.0.status', 'server')->assertJsonPath('data.0.client_id', null);

    saveApp('meta', ['client_id' => META_ID, 'client_secret' => META_SECRET])->assertOk();

    // Analista também conecta (lê o app sob RLS), mesmo sem poder editá-lo.
    $analyst = addUserToTenant($this->tenant, TenantRole::Analyst);
    security()->clear();
    $location = (string) $this->actingAs($analyst)
        ->get('/oauth/meta_ads/start?'.http_build_query(['tenant_id' => $this->tenant->id, 'mode' => 'live', 'flow' => 'flow_'.str_repeat('c', 20)]))
        ->headers->get('Location');
    parse_str((string) parse_url($location, PHP_URL_QUERY), $query);

    $this->actingAs($analyst)->get('/oauth/meta_ads/callback?'.http_build_query(['state' => $query['state'], 'code' => 'codigo']))
        ->assertOk()->assertSee('"status":"success"', false);

    expect($query['client_id'])->toBe(META_ID)
        ->and(asTenant($this->tenant, fn () => IntegrationConnection::query()->count()))->toBe(1);

    Http::assertSent(fn ($r) => str_contains($r->url(), 'code=codigo')
        && str_contains($r->url(), 'client_id='.META_ID)
        && str_contains($r->url(), 'client_secret='.META_SECRET));
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'segredo-do-servidor'));
});

it('Google: confere as credenciais e só libera o Google Ads com developer token', function () {
    Http::fake(['oauth2.googleapis.com/token' => Http::response(['error' => 'invalid_grant', 'error_description' => 'Malformed auth code.'], 400)]);

    saveApp('google', ['client_id' => GOOGLE_ID, 'client_secret' => GOOGLE_SECRET])
        ->assertOk()
        ->assertJsonPath('verification.status', 'verified')
        ->assertJsonPath('data.developer_token_hint', null)
        ->assertJsonPath('data.missing_platforms', ['google_ads']);

    Http::assertSent(fn ($r) => $r['grant_type'] === 'authorization_code'
        && $r['client_id'] === GOOGLE_ID
        && $r['redirect_uri'] === 'http://localhost:4300/oauth/ga4/callback');

    $providers = providersFor($this->tenant->id, $this->owner);
    expect($providers['ga4']['available_modes'])->toBe(['sandbox', 'live'])
        ->and($providers['google_ads']['available_modes'])->toBe(['sandbox'])
        ->and($providers['google_ads']['live_note'])->toContain('falta o developer token do Google Ads');

    // Segunda gravação sem a chave secreta: mantém a atual e acrescenta o developer token.
    saveApp('google', ['client_id' => GOOGLE_ID, 'client_secret' => '', 'developer_token' => 'AbCdEf123456_-xyz'])
        ->assertOk()
        ->assertJsonPath('data.client_secret_hint', '••••yz12')
        ->assertJsonPath('data.developer_token_hint', '••••-xyz')
        ->assertJsonPath('data.missing_platforms', []);

    expect(providersFor($this->tenant->id, $this->owner)['google_ads']['available_modes'])->toBe(['sandbox', 'live'])
        ->and(asTenant($this->tenant, fn () => OAuthApp::query()->sole()->client_secret))->toBe(GOOGLE_SECRET);
});

it('mostra quando a plataforma recusa as credenciais e avisa no card da integração', function () {
    Http::fake([
        'oauth2.googleapis.com/token' => Http::response(['error' => 'invalid_client', 'error_description' => 'The OAuth client was not found.'], 401),
        'graph.facebook.com/*' => Http::response(['error' => ['message' => 'Error validating client secret.', 'code' => 1]], 400),
    ]);

    saveApp('google', ['client_id' => GOOGLE_ID, 'client_secret' => GOOGLE_SECRET])
        ->assertOk()
        ->assertJsonPath('verification.status', 'invalid')
        ->assertJsonPath('data.status', 'invalid')
        ->assertJsonPath('data.verification_error', 'O Google recusou o ID do cliente ou a chave secreta. Confira os dois em APIs e serviços › Credenciais, no Google Cloud.');

    saveApp('meta', ['client_id' => META_ID, 'client_secret' => META_SECRET])
        ->assertJsonPath('verification.status', 'invalid')
        ->assertJsonPath('data.status', 'invalid');

    expect(providersFor($this->tenant->id, $this->owner)['ga4']['live_note'])->toContain('O Google recusou as credenciais do app do Google')
        ->and(providersFor($this->tenant->id, $this->owner)['facebook']['live_note'])->toContain('A Meta recusou as credenciais do app da Meta');
});

it('salva mesmo sem falar com a plataforma, testa de novo depois e zera a verificação ao trocar a credencial', function () {
    Http::fake([
        'graph.facebook.com/v24.0/oauth/access_token*' => Http::sequence()
            ->pushFailedConnection()
            ->push(['access_token' => 'app-token'])
            ->pushFailedConnection(),
        'graph.facebook.com/v24.0/'.META_ID.'*' => Http::response([], 500),
    ]);

    saveApp('meta', ['client_id' => META_ID, 'client_secret' => META_SECRET])
        ->assertOk()
        ->assertJsonPath('verification.status', 'unreachable')
        ->assertJsonPath('data.status', 'unverified');

    $this->actingAs($this->admin)->postJson('/api/platform-apps/meta/verify', [], $this->headers)
        ->assertOk()
        ->assertJsonPath('verification.status', 'verified')
        ->assertJsonPath('verification.message', 'A Meta confirmou o ID e a chave secreta do app.')
        ->assertJsonPath('data.status', 'verified');

    // Novo ID sem conseguir conferir: a verificação anterior não vale mais.
    saveApp('meta', ['client_id' => '9876543210'])
        ->assertOk()
        ->assertJsonPath('data.status', 'unverified')
        ->assertJsonPath('data.client_id', '9876543210')
        ->assertJsonPath('data.client_secret_hint', '••••c5d6');

    $this->actingAs($this->admin)->postJson('/api/platform-apps/google/verify', [], $this->headers)->assertNotFound();
});

it('valida os campos com mensagens claras', function () {
    saveApp('meta', ['client_id' => 'meu-app', 'client_secret' => META_SECRET])
        ->assertUnprocessable()->assertJsonValidationErrors(['client_id' => 'só números']);
    saveApp('meta', ['client_id' => META_ID])
        ->assertUnprocessable()->assertJsonValidationErrors(['client_secret' => 'Informe a chave secreta']);
    saveApp('meta', ['client_id' => META_ID, 'client_secret' => 'tem espaço no meio'])
        ->assertUnprocessable()->assertJsonValidationErrors('client_secret');
    saveApp('meta', ['client_id' => META_ID, 'client_secret' => META_SECRET, 'developer_token' => 'AbCdEf123456'])
        ->assertUnprocessable()->assertJsonValidationErrors('developer_token');
    saveApp('google', ['client_id' => '123456', 'client_secret' => GOOGLE_SECRET])
        ->assertUnprocessable()->assertJsonValidationErrors(['client_id' => '.apps.googleusercontent.com']);
    saveApp('google', ['client_id' => GOOGLE_ID, 'client_secret' => GOOGLE_SECRET, 'developer_token' => 'curto'])
        ->assertUnprocessable()->assertJsonValidationErrors('developer_token');

    $this->actingAs($this->admin)->putJson('/api/platform-apps/twitter', ['client_id' => '1'], $this->headers)->assertNotFound();
    expect(asTenant($this->tenant, fn () => OAuthApp::query()->count()))->toBe(0);
});

it('só dono e administrador configuram; analista e cliente não, nem direto no banco', function () {
    fakeMetaVerification();
    $analyst = addUserToTenant($this->tenant, TenantRole::Analyst);
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->clear();

    foreach ([$analyst, $client] as $user) {
        $this->actingAs($user)->getJson('/api/platform-apps', $this->headers)->assertForbidden();
        saveApp('meta', ['client_id' => META_ID, 'client_secret' => META_SECRET], $user)->assertForbidden();
        $this->actingAs($user)->deleteJson('/api/platform-apps/meta', [], $this->headers)->assertForbidden();
    }

    saveApp('meta', ['client_id' => META_ID, 'client_secret' => META_SECRET], $this->owner)->assertOk();
    $id = asTenant($this->tenant, fn () => OAuthApp::query()->value('id'));

    // Analista lê (precisa para conectar contas), mas não escreve; cliente nem enxerga.
    security()->run($this->tenant->id, $analyst->id, function () use ($id): void {
        expect(DB::table('oauth_apps')->count())->toBe(1)
            ->and(DB::table('oauth_apps')->where('id', $id)->update(['client_id' => '999999']))->toBe(0)
            ->and(DB::table('oauth_apps')->where('id', $id)->delete())->toBe(0)
            ->and(fn () => DB::transaction(fn () => DB::table('oauth_apps')->insert([
                'vendor' => 'google', 'client_id' => GOOGLE_ID, 'client_secret' => 'x',
            ])))->toThrow(QueryException::class, 'row-level security');
    });

    security()->run($this->tenant->id, $client->id, function (): void {
        expect(DB::table('oauth_apps')->count())->toBe(0);
    });

    // Sem usuário no contexto (job de sistema) também não grava credencial.
    asTenant($this->tenant, function () use ($id): void {
        expect(DB::table('oauth_apps')->where('id', $id)->update(['client_id' => '999999']))->toBe(0);
    });

    expect(asTenant($this->tenant, fn () => OAuthApp::query()->sole()->client_id))->toBe(META_ID);
});

it('remove o cadastro da agência e volta para as credenciais do servidor', function () {
    fakeMetaVerification();
    config(['services.meta.client_id' => '555555', 'services.meta.client_secret' => 'segredo-do-servidor']);

    saveApp('meta', ['client_id' => META_ID, 'client_secret' => META_SECRET])->assertJsonPath('data.source', 'agency');

    $this->actingAs($this->owner)->deleteJson('/api/platform-apps/meta', [], $this->headers)->assertNoContent();
    $this->actingAs($this->owner)->deleteJson('/api/platform-apps/meta', [], $this->headers)->assertNotFound();

    $this->actingAs($this->owner)->getJson('/api/platform-apps', $this->headers)
        ->assertJsonPath('data.0.status', 'server')
        ->assertJsonPath('data.0.source', 'server')
        ->assertJsonPath('data.0.client_secret_hint', null);

    security()->set($this->tenant->id, $this->owner->id);
    expect(AuditLog::query()->where('action', 'oauth_app.removed')->sole()->actor_user_id)->toBe($this->owner->id);
});
