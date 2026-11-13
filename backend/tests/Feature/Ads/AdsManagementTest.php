<?php

declare(strict_types=1);

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\DiscoveredAccount;
use App\Domain\Integrations\OAuth\OAuthTokens;
use App\Models\AdChange;
use App\Models\Project;
use App\Models\TimelineEvent;
use App\Support\Tenancy\TenantRole;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

/*
| Gestão de Meta Ads (ADR 0030).
*/

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora', 'niche' => 'ecommerce']));
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    security()->clear();
    $this->account = $meta->accounts->firstOrFail()->id;
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$this->account]], $this->headers)->assertOk();
});

function campaigns(string $account): array
{
    $t = test();

    return $t->actingAs($t->owner)->getJson("/api/ads/accounts/{$account}/campaigns", $t->headers)->assertOk()->json('data');
}

function adChange(string $account, array $body, array $headers = [])
{
    $t = test();

    return $t->actingAs($t->owner)->postJson("/api/ads/accounts/{$account}/changes", $body, [...$t->headers, ...$headers]);
}

it('lista as contas e as campanhas da demonstração, sempre as mesmas', function () {
    $accounts = $this->actingAs($this->owner)->getJson('/api/ads/accounts', $this->headers)->assertOk()->json('data');
    expect($accounts)->toHaveCount(1)->and($accounts[0]['mode'])->toBe('sandbox')->and($accounts[0]['projects'][0]['name'])->toBe('Padaria Aurora');

    $first = campaigns($this->account);
    expect(count($first))->toBeGreaterThanOrEqual(3)->toBeLessThanOrEqual(5)
        ->and($first[0]['adsets'])->not->toBeEmpty()
        ->and(campaigns($this->account))->toEqual($first);
});

it('pausa uma campanha, registra quem fez e marca na linha do tempo', function () {
    $active = collect(campaigns($this->account))->firstWhere('status', 'ACTIVE');

    $change = adChange($this->account, ['level' => 'campaign', 'object_id' => $active['id'], 'action' => 'pause'])->assertCreated()->json('data');
    expect($change['before'])->toBe(['status' => 'ACTIVE'])->and($change['after'])->toBe(['status' => 'PAUSED'])->and($change['status'])->toBe('applied');

    $now = collect(campaigns($this->account))->firstWhere('id', $active['id']);
    expect($now['status'])->toBe('PAUSED')->and($now['spend_7d'])->toEqual(0);

    adChange($this->account, ['level' => 'campaign', 'object_id' => $active['id'], 'action' => 'pause'])->assertUnprocessable()->assertJsonValidationErrors(['action' => 'já está pausado']);

    $events = asTenant($this->tenant, fn () => TimelineEvent::query()->where('project_id', $this->project->id)->where('type', 'ads_change')->pluck('title')->all());
    expect($events)->toBe(["Campanha pausado(a): {$active['name']}"]);

    $log = $this->actingAs($this->owner)->getJson('/api/ads/changes?project_id=', $this->headers)->assertOk()->json('data');
    expect($log[0]['created_by'])->toBe($this->owner->name);
});

it('muda o orçamento diário com trava acima de 50% e respeita onde o orçamento mora', function () {
    $all = collect(campaigns($this->account));
    $withAdsetBudget = $all->first(fn ($c) => $c['daily_budget'] === null);
    $target = $withAdsetBudget !== null
        ? ['level' => 'adset', 'object' => $withAdsetBudget['adsets'][0]]
        : ['level' => 'campaign', 'object' => $all->first()];
    $current = $target['object']['daily_budget'];

    $bump = round($current * 1.3, 2);
    $change = adChange($this->account, ['level' => $target['level'], 'object_id' => $target['object']['id'], 'action' => 'budget', 'daily_budget' => $bump])->assertCreated()->json('data');
    expect($change['before']['daily_budget'])->toEqual($current)->and($change['after']['daily_budget'])->toEqual($bump);

    adChange($this->account, ['level' => $target['level'], 'object_id' => $target['object']['id'], 'action' => 'budget', 'daily_budget' => round($bump * 1.8, 2)])
        ->assertUnprocessable()->assertJsonValidationErrors(['daily_budget' => 'Mudança de 80%']);
    adChange($this->account, ['level' => $target['level'], 'object_id' => $target['object']['id'], 'action' => 'budget', 'daily_budget' => round($bump * 1.8, 2), 'confirm_large_change' => true])
        ->assertCreated();

    if ($withAdsetBudget !== null) {
        adChange($this->account, ['level' => 'campaign', 'object_id' => $withAdsetBudget['id'], 'action' => 'budget', 'daily_budget' => 100])
            ->assertUnprocessable()->assertJsonValidationErrors(['daily_budget' => 'distribui o orçamento nos conjuntos']);
    }
});

it('não aplica duas vezes o mesmo pedido (Idempotency-Key)', function () {
    $campaign = collect(campaigns($this->account))->firstWhere('status', 'ACTIVE');
    $key = ['Idempotency-Key' => 'pausa-black-friday-001'];

    $first = adChange($this->account, ['level' => 'campaign', 'object_id' => $campaign['id'], 'action' => 'pause'], $key)->assertCreated()->json('data.id');
    $again = adChange($this->account, ['level' => 'campaign', 'object_id' => $campaign['id'], 'action' => 'pause'], $key)->assertOk()->json('data.id');

    expect($again)->toBe($first)->and(asTenant($this->tenant, fn () => AdChange::query()->count()))->toBe(1);
});

it('altera de verdade na Meta, em centavos, e registra a falha quando falta permissão', function () {
    Http::fake([
        'graph.facebook.com/v24.0/act_777/campaigns*' => Http::response(['data' => [
            ['id' => '120200000000010', 'name' => 'Vendas · Black Friday', 'status' => 'ACTIVE', 'effective_status' => 'ACTIVE', 'objective' => 'OUTCOME_SALES', 'daily_budget' => '15000'],
        ]]),
        'graph.facebook.com/v24.0/act_777/adsets*' => Http::response(['data' => [
            ['id' => '120200000000011', 'name' => 'Lookalike', 'campaign_id' => '120200000000010', 'status' => 'ACTIVE', 'effective_status' => 'ACTIVE'],
        ]]),
        'graph.facebook.com/v24.0/act_777/insights*' => Http::response(['data' => [
            ['campaign_id' => '120200000000010', 'adset_id' => '120200000000011', 'spend' => '980.50', 'actions' => [['action_type' => 'purchase', 'value' => '21']]],
        ]]),
        'graph.facebook.com/v24.0/120200000000010' => Http::sequence()->push(['success' => true])->push(['error' => ['code' => 200, 'message' => 'Requires ads_management permission']], 403),
        'graph.facebook.com/*' => Http::response(['data' => []]),
    ]);
    $live = security()->run($this->tenant->id, $this->owner->id, fn () => app(ConnectionManager::class)
        ->connectLive('meta_ads', new OAuthTokens('EAAG-live', null, CarbonImmutable::now()->addDays(40)), [new DiscoveredAccount('act_777', 'Conta real', 'ad_account', 'BRL')], $this->owner->id)
        ->accounts()->value('id'));
    security()->clear();

    $campaign = campaigns($live)[0];
    expect($campaign['daily_budget'])->toEqual(150.0)->and($campaign['spend_7d'])->toEqual(980.5)->and($campaign['results_7d'])->toEqual(21.0);

    adChange($live, ['level' => 'campaign', 'object_id' => '120200000000010', 'action' => 'budget', 'daily_budget' => 195])->assertCreated();
    Http::assertSent(fn (Request $r) => $r->method() === 'POST' && str_ends_with($r->url(), '/120200000000010') && $r['daily_budget'] === '19500' && $r->hasHeader('Authorization', 'Bearer EAAG-live'));

    adChange($live, ['level' => 'campaign', 'object_id' => '120200000000010', 'action' => 'pause'])
        ->assertUnprocessable()->assertJsonValidationErrors(['change' => 'permissão necessária']);
    expect(asTenant($this->tenant, fn () => AdChange::query()->where('status', 'failed')->count()))->toBe(1);
});

it('só a equipe da agência gerencia anúncios', function () {
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    $this->actingAs($client)->getJson('/api/ads/accounts', $this->headers)->assertForbidden();

    [$other, $otherOwner] = tenantWithOwner('Agência Boreal');
    $this->actingAs($otherOwner)->getJson("/api/ads/accounts/{$this->account}/campaigns", ['X-Tenant-Id' => $other->id])->assertNotFound();
});
