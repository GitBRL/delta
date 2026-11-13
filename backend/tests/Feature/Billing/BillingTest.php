<?php

declare(strict_types=1);

use App\Models\Project;
use App\Models\Subscription;
use App\Support\Tenancy\TenantRole;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/*
| Billing (ADR 0031): planos, limites, recursos e franquias. Leitura nunca é bloqueada.
*/

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
});

function plan(string $plan, string $status = 'active', int $days = 30): void
{
    expect(Artisan::call('billing:plan', ['tenant' => test()->tenant->id, 'plan' => $plan, '--status' => $status, '--days' => $days]))->toBe(0);
    security()->clear();
}

function newProject(string $name = 'Projeto')
{
    $t = test();

    return $t->actingAs($t->owner)->postJson('/api/projects', ['name' => $name], $t->headers);
}

it('o cadastro começa com 14 dias de teste com tudo liberado', function () {
    $this->postJson('/auth/register', [
        'name' => 'Bia', 'email' => 'bia@nova.com', 'password' => 'Senha-forte-2026', 'password_confirmation' => 'Senha-forte-2026', 'company_name' => 'Agência Nova',
    ])->assertSuccessful();
    $tenantId = $this->getJson('/api/me')->assertOk()->json('data.tenants.0.id') ?? $this->getJson('/api/me')->json('tenants.0.id');
    $sub = security()->run($tenantId, null, fn () => Subscription::query()->sole());

    expect($sub->plan)->toBe('trial')->and($sub->status)->toBe('trialing')
        ->and(round(now()->diffInDays($sub->trial_ends_at)))->toEqual(14.0);
});

it('teste vencido: não cria nada novo, mas tudo continua visível', function () {
    asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Antigo']));
    plan('trial', 'trialing', -1);

    newProject()->assertStatus(402)->assertJsonPath('plan_limit.limit', 'plan')
        ->assertJsonPath('message', fn (string $m) => str_contains($m, 'período de teste da agência terminou'));
    $this->actingAs($this->owner)->getJson('/api/projects', $this->headers)->assertOk()->assertJsonCount(1, 'data');
});

it('respeita os limites e recursos do plano Essencial', function () {
    plan('essencial');
    config(['billing.plans.essencial.limits.projects' => 2, 'billing.plans.essencial.limits.seats' => 2]);

    newProject('Projeto A')->assertCreated();
    newProject('Projeto B')->assertCreated();
    newProject('Projeto C')->assertStatus(402)->assertJsonPath('plan_limit', ['limit' => 'projects', 'allowed' => 2, 'used' => 2])
        ->assertJsonPath('message', fn (string $m) => str_contains($m, 'O plano Essencial permite até 2 projetos'));

    // Lugares: o dono + um convite pendente = 2; o terceiro (equipe) não cabe; cliente não conta.
    $this->actingAs($this->owner)->postJson('/api/team/invitations', ['email' => 'ana@aurora.com', 'role' => 'analyst'], $this->headers)->assertCreated();
    $this->actingAs($this->owner)->postJson('/api/team/invitations', ['email' => 'rui@aurora.com', 'role' => 'admin'], $this->headers)->assertStatus(402);

    // Recursos fora do Essencial.
    $this->actingAs($this->owner)->postJson('/api/api-tokens', ['name' => 'BI', 'scopes' => ['projects:read']], $this->headers)->assertStatus(402)
        ->assertJsonPath('message', fn (string $m) => str_contains($m, 'API pública e webhooks não faz parte do plano Essencial'));
    $this->actingAs($this->owner)->putJson('/api/branding', ['custom_domain' => 'relatorios.aurora.com.br'], $this->headers)->assertStatus(402);
    $this->actingAs($this->owner)->putJson('/api/branding', ['display_name' => 'Aurora'], $this->headers)->assertOk(); // o básico da marca continua
});

it('não abre o login real quando as conexões do plano acabaram', function () {
    plan('essencial');
    config(['billing.plans.essencial.limits.live_connections' => 0, 'services.meta.client_id' => 'app', 'services.meta.client_secret' => 'segredo']);

    $response = $this->actingAs($this->owner)->get('/oauth/meta_ads/start?'.http_build_query(['tenant_id' => $this->tenant->id, 'mode' => 'live', 'flow' => 'flow_'.str_repeat('p', 20), 'return' => 'popup']));
    $response->assertStatus(400)->assertSee('conexões reais com plataformas', false);

    // Demonstração continua liberada.
    $this->actingAs($this->owner)->get('/oauth/meta_ads/start?'.http_build_query(['tenant_id' => $this->tenant->id, 'mode' => 'sandbox', 'flow' => 'flow_'.str_repeat('q', 20), 'return' => 'popup']))->assertRedirect();
});

it('a franquia de IA do plano limita o orçamento da agência', function () {
    plan('pro');
    config(['billing.plans.pro.limits.ai_tokens' => 1000]);
    $this->actingAs($this->owner)->putJson('/api/ai', ['api_key' => 'sk-ant-api03-'.str_repeat('x', 30), 'enabled' => true, 'monthly_token_budget' => 2_000_000], $this->headers)
        ->assertOk()->assertJsonPath('data.budget', 1000);

    plan('trial', 'trialing', -1);
    $this->actingAs($this->owner)->getJson('/api/ai', $this->headers)->assertOk()->assertJsonPath('data.budget', 0);
});

it('mostra plano, uso e catálogo para dono e administrador', function () {
    plan('pro');
    asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Um']));

    $billing = $this->actingAs($this->owner)->getJson('/api/billing', $this->headers)->assertOk()->json('data');
    expect($billing['plan'])->toBe('pro')->and($billing['name'])->toBe('Pro')->and($billing['usable'])->toBeTrue()
        ->and($billing['usage']['projects'])->toBe(1)->and($billing['usage']['seats'])->toBe(1)
        ->and($billing['features']['white_label'])->toBeFalse()
        ->and(collect($billing['plans'])->pluck('key')->all())->toBe(['essencial', 'pro', 'agencia']);

    $analyst = addUserToTenant($this->tenant, TenantRole::Analyst);
    $this->actingAs($analyst)->getJson('/api/billing', $this->headers)->assertForbidden();
});

it('ninguém troca o próprio plano pelo banco: só o sistema', function () {
    plan('essencial');

    $changed = security()->run($this->tenant->id, $this->owner->id, fn () => DB::table('subscriptions')->update(['plan' => 'agencia']));
    security()->clear();
    expect($changed)->toBe(0)
        ->and(security()->run($this->tenant->id, null, fn () => Subscription::query()->value('plan')))->toBe('essencial');

    expect(fn () => security()->run($this->tenant->id, $this->owner->id, fn () => DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $this->tenant->id, 'plan' => 'agencia', 'status' => 'active', 'provider' => 'manual', 'created_at' => now(), 'updated_at' => now(),
    ])))->toThrow(QueryException::class);
});

it('agência criada antes do billing: teste grátis contado da criação', function () {
    newProject()->assertCreated();

    asTenant($this->tenant, fn () => DB::table('tenants')->where('id', $this->tenant->id)->update(['created_at' => now()->subDays(30)]));
    newProject('Depois do teste')->assertStatus(402);
});
