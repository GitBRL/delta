<?php

declare(strict_types=1);

use App\Domain\Webhooks\UrlGuard;
use App\Domain\Webhooks\Webhooks;
use App\Models\Project;
use App\Models\WebhookDelivery;
use App\Support\Tenancy\TenantRole;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora']));
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$meta->accounts->firstOrFail()->id]], $this->headers)->assertOk();
});

function apiToken(array $scopes, ?int $days = null): string
{
    $t = test();

    return (string) $t->actingAs($t->owner)->postJson('/api/api-tokens', ['name' => 'Integração BI', 'scopes' => $scopes, 'expires_in_days' => $days], $t->headers)
        ->assertCreated()->json('token');
}

/** Chamada à API v1 sem sessão (como um sistema externo). */
function v1(string $method, string $uri, string $token, array $body = [])
{
    auth()->forgetGuards();
    security()->clear();

    return test()->json($method, "/api/v1{$uri}", $body, ['Authorization' => "Bearer {$token}"]);
}

it('cria token mostrado uma única vez e autentica a API v1 com escopos', function () {
    $token = apiToken(['projects:read', 'metrics:read']);
    expect($token)->toMatch('/^dlt_[A-Za-z0-9]{40}$/');

    $listed = $this->actingAs($this->owner)->getJson('/api/api-tokens', $this->headers)->assertOk();
    expect($listed->getContent())->not->toContain($token)->and($listed->json('data.0.prefix'))->toBe(substr($token, 0, 10));

    v1('GET', '/projects', $token)->assertOk()->assertJsonPath('data.0.name', 'Padaria Aurora');
    v1('POST', "/projects/{$this->project->id}/metrics/query", $token, [
        'start' => now()->subDays(7)->toDateString(), 'end' => now()->subDay()->toDateString(), 'compare' => 'none', 'metrics' => ['meta_ads:spend'],
    ])->assertOk()->assertJsonPath('data.metrics.0.key', 'meta_ads:spend');
    v1('GET', '/reports', $token)->assertForbidden()->assertJsonPath('message', 'Este token não tem o escopo reports:read.');
    v1('GET', '/projects', 'dlt_'.str_repeat('x', 40))->assertUnauthorized();

    expect(security()->run($this->tenant->id, null, fn () => DB::table('api_tokens')->value('last_used_at')))->not->toBeNull();
});

it('token revogado ou expirado não entra; e cada token só enxerga a própria agência', function () {
    $token = apiToken(['projects:read']);
    $expiring = apiToken(['projects:read'], 1);
    [$other, $otherOwner] = tenantWithOwner('Agência Boreal');
    $foreign = asTenant($other, fn () => Project::query()->create(['name' => 'Projeto da Boreal']));

    v1('GET', "/projects/{$foreign->id}", $token)->assertNotFound();

    $id = $this->actingAs($this->owner)->getJson('/api/api-tokens', $this->headers)->json('data.1.id');
    $this->actingAs($this->owner)->deleteJson("/api/api-tokens/{$id}", [], $this->headers)->assertNoContent();
    v1('GET', '/projects', $token)->assertUnauthorized();

    $this->travel(2)->days();
    v1('GET', '/projects', $expiring)->assertUnauthorized();

    $analyst = addUserToTenant($this->tenant, TenantRole::Analyst);
    security()->clear();
    $this->actingAs($analyst)->postJson('/api/api-tokens', ['name' => 'x', 'scopes' => ['projects:read']], $this->headers)->assertForbidden();
});

it('entrega webhooks assinados quando um relatório é publicado', function () {
    Storage::fake('local');
    $received = [];
    Http::fake([
        'gotenberg:3000/*' => Http::response('%PDF-1.7', 200),
        'hooks.cliente.test/*' => function (Request $r) use (&$received) {
            $received[] = $r;

            return Http::response('ok', 200);
        },
    ]);

    $created = $this->actingAs($this->owner)->postJson('/api/webhooks', ['url' => 'https://hooks.cliente.test/delta', 'events' => ['report.published']], $this->headers)->assertCreated();
    $secret = (string) $created->json('secret');
    expect($secret)->toStartWith('whsec_');

    $report = $this->actingAs($this->owner)->postJson('/api/reports', ['project_id' => $this->project->id, 'title' => 'Mensal'], $this->headers)->json('data');
    $snapshot = $this->actingAs($this->owner)->postJson("/api/reports/{$report['id']}/snapshots", [], $this->headers)->assertCreated()->json('data');

    expect($received)->toHaveCount(1);
    $request = $received[0];
    $body = $request->body();
    preg_match('/^t=(\d+),v1=([a-f0-9]{64})$/', $request->header('X-Delta-Signature')[0], $sig);

    expect($request->header('X-Delta-Event')[0])->toBe('report.published')
        ->and(hash_equals(hash_hmac('sha256', $sig[1].'.'.$body, $secret), $sig[2]))->toBeTrue()
        ->and(json_decode($body, true)['data']['snapshot_id'])->toBe($snapshot['id']);

    $deliveries = $this->actingAs($this->owner)->getJson("/api/webhooks/{$created->json('data.id')}/deliveries", $this->headers)->json('data');
    expect($deliveries[0]['status'])->toBe('delivered');
});

it('registra falha de entrega sem derrubar a publicação e testa com ping', function () {
    Storage::fake('local');
    Http::fake(['gotenberg:3000/*' => Http::response('%PDF-1.7', 200), 'hooks.cliente.test/*' => Http::response('erro', 500)]);
    $id = $this->actingAs($this->owner)->postJson('/api/webhooks', ['url' => 'https://hooks.cliente.test/x', 'events' => ['*']], $this->headers)->json('data.id');

    $report = $this->actingAs($this->owner)->postJson('/api/reports', ['project_id' => $this->project->id, 'title' => 'Mensal'], $this->headers)->json('data');
    $this->actingAs($this->owner)->postJson("/api/reports/{$report['id']}/snapshots", [], $this->headers)->assertCreated();

    $failed = security()->run($this->tenant->id, $this->owner->id, fn () => WebhookDelivery::query()->where('event', 'report.published')->sole());
    expect($failed->status)->toBe('failed')->and($failed->last_status_code)->toBe(500);

    $this->actingAs($this->owner)->postJson("/api/webhooks/{$id}/test", [], $this->headers)->assertAccepted()->assertJsonPath('data.event', 'ping');
    $this->actingAs($this->owner)->postJson('/api/webhooks', ['url' => 'javascript:alert(1)', 'events' => ['*']], $this->headers)->assertUnprocessable();
});

it('bloqueia webhooks para endereços internos (SSRF)', function () {
    $guard = new class(false) extends UrlGuard
    {
        protected function resolve(string $host): array
        {
            return ['metadata.interna' => ['169.254.169.254'], 'banco.interno' => ['10.0.0.5'], 'api.cliente.com' => ['93.184.216.34']][$host] ?? [];
        }
    };

    expect(fn () => $guard->check('http://api.cliente.com/x'))->toThrow(ValidationException::class)
        ->and(fn () => $guard->check('https://metadata.interna/latest'))->toThrow(ValidationException::class)
        ->and(fn () => $guard->check('https://banco.interno/'))->toThrow(ValidationException::class)
        ->and(fn () => $guard->check('https://127.0.0.1/'))->toThrow(ValidationException::class)
        ->and(fn () => $guard->check('https://user:pass@api.cliente.com/'))->toThrow(ValidationException::class);

    $guard->check('https://api.cliente.com/webhook');
    expect(Webhooks::signature('s', 1, 'x'))->toBe('t=1,v1='.hash_hmac('sha256', '1.x', 's'));
});

it('gerencia webhooks pela API v1 com o escopo certo', function () {
    $token = apiToken(['webhooks:manage']);

    v1('POST', '/webhooks', $token, ['url' => 'https://hooks.cliente.test/a', 'events' => ['goal.status_changed']])->assertCreated();
    v1('GET', '/webhooks', $token)->assertOk()->assertJsonCount(1, 'data');
    v1('GET', '/projects', $token)->assertForbidden();
});
