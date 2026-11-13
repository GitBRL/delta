<?php

declare(strict_types=1);

use App\Domain\Integrations\ConnectionManager;
use App\Support\Tenancy\TenantRole;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência A');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
});

it('conecta uma conta de demonstração e grava o histórico inicial', function () {
    $response = $this->actingAs($this->owner)
        ->postJson('/api/connections', ['provider' => 'meta_ads', 'mode' => 'sandbox'], $this->headers)
        ->assertCreated()
        ->assertJsonPath('data.provider', 'meta_ads')
        ->assertJsonPath('data.mode', 'sandbox')
        ->assertJsonPath('data.status', 'active') // fila "sync" nos testes: o backfill já terminou
        ->assertJsonCount(1, 'data.accounts');

    $accountId = $response->json('data.accounts.0.id');
    security()->set($this->tenant->id, $this->owner->id);

    $facts = DB::table('metric_facts_daily')->where('integration_account_id', $accountId);
    $yesterday = ConnectionManager::yesterday();

    expect((clone $facts)->distinct()->count('metric_key'))->toBe(7)
        ->and((clone $facts)->count())->toBe(ConnectionManager::BACKFILL_DAYS * 7)
        ->and((clone $facts)->max('date'))->toBe($yesterday->toDateString())
        ->and((clone $facts)->min('date'))->toBe($yesterday->subDays(ConnectionManager::BACKFILL_DAYS - 1)->toDateString())
        ->and(DB::table('sync_runs')->where('status', 'done')->count())->toBe(1);
});

it('gera dados coerentes entre si', function () {
    $connection = connectSandbox($this->tenant, $this->owner);
    security()->set($this->tenant->id, $this->owner->id);

    $day = DB::table('metric_facts_daily')
        ->where('integration_account_id', $connection->accounts->first()?->id)
        ->where('date', ConnectionManager::yesterday()->toDateString())
        ->pluck('value', 'metric_key')
        ->map(fn ($v) => (float) $v);

    expect($day['meta_ads:link_clicks'])->toBeLessThanOrEqual($day['meta_ads:impressions'])
        ->and($day['meta_ads:conversions'])->toBeLessThanOrEqual($day['meta_ads:link_clicks'])
        ->and($day['meta_ads:reach'])->toBeLessThanOrEqual($day['meta_ads:impressions'])
        ->and($day['meta_ads:spend'])->toBeGreaterThan(0);
});

it('é idempotente: sincronizar de novo não duplica dados', function () {
    $connection = connectSandbox($this->tenant, $this->owner);
    security()->clear();

    $this->actingAs($this->owner)
        ->postJson("/api/connections/{$connection->id}/sync", [], $this->headers)
        ->assertStatus(202);

    security()->set($this->tenant->id, $this->owner->id);
    expect(DB::table('metric_facts_daily')->count())->toBe(ConnectionManager::BACKFILL_DAYS * 7)
        ->and(DB::table('sync_runs')->count())->toBe(2);
});

it('recusa conexão real enquanto a plataforma não aprova', function () {
    $this->actingAs($this->owner)
        ->postJson('/api/connections', ['provider' => 'meta_ads', 'mode' => 'live'], $this->headers)
        ->assertUnprocessable()
        ->assertJsonValidationErrors('mode');
});

it('recusa plataforma desconhecida', function () {
    $this->actingAs($this->owner)
        ->postJson('/api/connections', ['provider' => 'orkut', 'mode' => 'sandbox'], $this->headers)
        ->assertUnprocessable()
        ->assertJsonValidationErrors('provider');
});

it('não deixa o papel cliente conectar contas', function () {
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->clear();

    $this->actingAs($client)
        ->postJson('/api/connections', ['provider' => 'meta_ads', 'mode' => 'sandbox'], $this->headers)
        ->assertForbidden();
});

it('isola conexões entre agências', function () {
    [$other, $otherOwner] = tenantWithOwner('Agência B');
    $foreign = connectSandbox($other, $otherOwner, 'ga4');
    connectSandbox($this->tenant, $this->owner, 'instagram');
    security()->clear();

    $this->actingAs($this->owner)
        ->getJson('/api/connections', $this->headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.provider', 'instagram');

    $this->actingAs($this->owner)
        ->postJson("/api/connections/{$foreign->id}/sync", [], $this->headers)
        ->assertNotFound();
});

it('nunca devolve as credenciais na API', function () {
    connectSandbox($this->tenant, $this->owner);
    security()->clear();

    $json = $this->actingAs($this->owner)->getJson('/api/connections', $this->headers)->json('data.0');

    expect($json)->not->toHaveKey('credentials');
});

it('lista as plataformas e o catálogo de métricas', function () {
    $this->actingAs($this->owner)->getJson('/api/providers')->assertStatus(400); // exige a agência

    $this->actingAs($this->owner)->getJson('/api/providers', $this->headers)
        ->assertOk()
        ->assertJsonCount(10, 'data')
        ->assertJsonPath('data.0.key', 'meta_ads')
        ->assertJsonPath('data.0.app_vendor', 'meta')
        ->assertJsonPath('data.0.available_modes', ['sandbox']);

    $metrics = $this->actingAs($this->owner)->getJson('/api/metrics/catalog?provider=ga4')->assertOk()->json('data');

    expect(collect($metrics)->pluck('key'))->not->toContain('ga4:engagement_duration') // componente interno
        ->and(collect($metrics)->pluck('provider')->unique()->all())->toBe(['ga4']);
});
