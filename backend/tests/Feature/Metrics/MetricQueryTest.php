<?php

declare(strict_types=1);

use App\Domain\Integrations\ConnectionManager;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Support\Tenancy\TenantRole;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência A');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Loja Aurora']));
    $this->meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    $this->instagram = connectSandbox($this->tenant, $this->owner, 'instagram');
    $this->metaAccount = $this->meta->accounts->firstOrFail()->id;
    $this->igAccount = $this->instagram->accounts->firstOrFail()->id;
    security()->clear();

    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)
        ->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$this->metaAccount, $this->igAccount]], $this->headers)
        ->assertOk()
        ->assertJsonCount(2, 'data');

    $this->end = ConnectionManager::yesterday();
    $this->start = $this->end->subDays(29);
});

function query(array $body): array
{
    $test = test();

    return $test->actingAs($test->owner)
        ->postJson("/api/projects/{$test->project->id}/metrics/query", [
            'start' => $test->start->toDateString(),
            'end' => $test->end->toDateString(),
            'compare' => 'none',
            ...$body,
        ], $test->headers)
        ->assertOk()
        ->json('data');
}

function metric(array $data, string $key): array
{
    return collect($data['metrics'])->firstWhere('key', $key);
}

/** Soma direto no banco, para conferir o serviço contra a fonte. */
function factSum(string $account, string $key, string $start, string $end): float
{
    security()->set(test()->tenant->id, test()->owner->id);

    return (float) DB::table('metric_facts_daily')
        ->where('integration_account_id', $account)->where('metric_key', $key)
        ->whereBetween('date', [$start, $end])->sum('value');
}

it('soma as métricas aditivas no período', function () {
    $spend = metric(query(['metrics' => ['meta_ads:spend']]), 'meta_ads:spend');

    expect($spend['value'])->toEqualWithDelta(factSum($this->metaAccount, 'meta_ads:spend', $this->start->toDateString(), $this->end->toDateString()), 0.01)
        ->and($spend['unit'])->toBe('currency')
        ->and($spend['label'])->toBe('Investimento');
});

it('calcula razões pela razão das somas, nunca pela média das razões diárias', function () {
    $ctr = metric(query(['metrics' => ['meta_ads:ctr']]), 'meta_ads:ctr');
    [$s, $e] = [$this->start->toDateString(), $this->end->toDateString()];

    $expected = factSum($this->metaAccount, 'meta_ads:link_clicks', $s, $e) / factSum($this->metaAccount, 'meta_ads:impressions', $s, $e) * 100;

    expect($ctr['value'])->toEqualWithDelta($expected, 1e-6);
});

it('não soma o alcance dos dias e guarda o valor do período em cache', function () {
    $data = query(['metrics' => ['meta_ads:reach', 'meta_ads:frequency', 'meta_ads:impressions']]);
    $reach = metric($data, 'meta_ads:reach')['value'];
    $dailySum = factSum($this->metaAccount, 'meta_ads:reach', $this->start->toDateString(), $this->end->toDateString());

    expect($reach)->toBeLessThan($dailySum)
        ->and(metric($data, 'meta_ads:frequency')['value'])->toEqualWithDelta(metric($data, 'meta_ads:impressions')['value'] / $reach, 1e-6)
        ->and(DB::table('metric_period_values')->where('metric_key', 'meta_ads:reach')->count())->toBe(1);
});

it('usa o último dia do período para seguidores', function () {
    $followers = metric(query(['metrics' => ['instagram:followers']]), 'instagram:followers');

    security()->set($this->tenant->id, $this->owner->id);
    $lastDay = (float) DB::table('metric_facts_daily')
        ->where('integration_account_id', $this->igAccount)->where('metric_key', 'instagram:followers')
        ->where('date', $this->end->toDateString())->value('value');

    expect($followers['value'])->toEqualWithDelta($lastDay, 0.001);
});

it('compara com o período anterior e classifica a tendência', function () {
    $data = query(['metrics' => ['meta_ads:cpa'], 'compare' => 'previous_period']);
    $cpa = metric($data, 'meta_ads:cpa');

    expect($data['comparison'])->toBe([
        'start' => $this->start->subDays(30)->toDateString(),
        'end' => $this->start->subDay()->toDateString(),
    ])
        ->and($cpa['previous'])->not->toBeNull()
        ->and($cpa['change_pct'])->toEqualWithDelta(($cpa['value'] - $cpa['previous']) / abs($cpa['previous']) * 100, 0.01)
        ->and($cpa['sentiment'])->toBe(match (true) {
            abs($cpa['change_pct']) < 0.5 => 'neutral',
            $cpa['change_pct'] < 0 => 'positive', // CPA caindo é bom
            default => 'negative',
        });
});

it('devolve séries diárias alinhadas com a comparação', function () {
    $item = metric(query(['metrics' => ['meta_ads:roas'], 'compare' => 'previous_year', 'series' => true]), 'meta_ads:roas');

    expect($item['series'])->toHaveCount(30)
        ->and($item['previous_series'])->toHaveCount(30)
        ->and($item['series'][0]['date'])->toBe($this->start->toDateString())
        ->and($item['series'][29]['date'])->toBe($this->end->toDateString())
        ->and($item['previous_series'][0]['date'])->toBe($this->start->subYearNoOverflow()->toDateString())
        ->and(collect($item['series'])->whereNotNull('value'))->toHaveCount(30);
});

it('devolve nulo, sem erro, para canal sem conta vinculada', function () {
    $cost = metric(query(['metrics' => ['google_ads:cost'], 'compare' => 'previous_period']), 'google_ads:cost');

    expect($cost['value'])->toBeNull()
        ->and($cost['change_pct'])->toBeNull()
        ->and($cost['sentiment'])->toBe('neutral');
});

it('valida o pedido', function (array $body, string $field) {
    $this->actingAs($this->owner)
        ->postJson("/api/projects/{$this->project->id}/metrics/query", [
            'start' => $this->start->toDateString(),
            'end' => $this->end->toDateString(),
            'compare' => 'none',
            'metrics' => ['meta_ads:spend'],
            ...$body,
        ], $this->headers)
        ->assertUnprocessable()
        ->assertJsonValidationErrors($field);
})->with([
    'fim no futuro' => [['end' => now()->addDays(3)->toDateString()], 'end'],
    'fim antes do início' => [['start' => now()->subDays(2)->toDateString(), 'end' => now()->subDays(5)->toDateString()], 'end'],
    'período longo demais' => [['start' => now()->subDays(500)->toDateString(), 'end' => now()->subDays(2)->toDateString()], 'end'],
    'métrica desconhecida' => [['metrics' => ['meta_ads:spend', 'meta_ads:inventada']], 'metrics.1'],
    'comparação inválida' => [['compare' => 'semana_passada'], 'compare'],
    'sem métricas' => [['metrics' => []], 'metrics'],
]);

it('não expõe projeto de outra agência', function () {
    [$other] = tenantWithOwner('Agência B');
    $foreign = asTenant($other, fn () => Project::query()->create(['name' => 'Projeto da B']));
    security()->clear();

    $this->actingAs($this->owner)
        ->postJson("/api/projects/{$foreign->id}/metrics/query", ['start' => $this->start->toDateString(), 'end' => $this->end->toDateString(), 'compare' => 'none', 'metrics' => ['meta_ads:spend']], $this->headers)
        ->assertNotFound();
});

it('não deixa vincular conta de outra agência ao projeto', function () {
    [$other, $otherOwner] = tenantWithOwner('Agência B');
    $foreign = connectSandbox($other, $otherOwner, 'meta_ads');
    security()->clear();

    $this->actingAs($this->owner)
        ->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$foreign->accounts->firstOrFail()->id]], $this->headers)
        ->assertUnprocessable()
        ->assertJsonValidationErrors('account_ids.0');
});

it('deixa o cliente consultar o próprio projeto, mas não mudar as contas', function () {
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    asTenant($this->tenant, fn () => ProjectMember::query()->create(['project_id' => $this->project->id, 'user_id' => $client->id]));
    security()->clear();

    $this->actingAs($client)
        ->postJson("/api/projects/{$this->project->id}/metrics/query", ['start' => $this->start->toDateString(), 'end' => $this->end->toDateString(), 'compare' => 'none', 'metrics' => ['meta_ads:spend']], $this->headers)
        ->assertOk();

    $this->actingAs($client)
        ->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => []], $this->headers)
        ->assertForbidden();
});
