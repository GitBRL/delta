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
    $this->ga4 = connectSandbox($this->tenant, $this->owner, 'ga4');
    $this->metaAccount = $this->meta->accounts->firstOrFail()->id;
    $this->ga4Account = $this->ga4->accounts->firstOrFail()->id;
    security()->clear();

    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", [
        'account_ids' => [$this->metaAccount, $this->ga4Account],
    ], $this->headers)->assertOk();

    $this->end = ConnectionManager::yesterday();
    $this->start = $this->end->subDays(29);
});

function attention(): array
{
    $t = test();

    return $t->actingAs($t->owner)->postJson("/api/projects/{$t->project->id}/attention", [
        'start' => $t->start->toDateString(), 'end' => $t->end->toDateString(),
    ], $t->headers)->assertOk()->json('data');
}

function setGoals(array $goals): void
{
    $t = test();
    $t->actingAs($t->owner)->patchJson("/api/projects/{$t->project->id}", ['goals' => $goals], $t->headers)->assertOk();
}

function signal(array $data, string $rule): ?array
{
    return collect($data['signals'])->firstWhere('rule', $rule);
}

/** Reescreve valores diários direto no banco (no contexto da agência) para provocar uma regra. */
function setDaily(string $account, string $metric, string $from, string $to, float $value): void
{
    $t = test();
    security()->run($t->tenant->id, null, fn () => DB::table('metric_facts_daily')
        ->where('integration_account_id', $account)->where('metric_key', $metric)
        ->whereBetween('date', [$from, $to])->update(['value' => $value]));
}

it('alerta prejuízo quando o ROAS fica abaixo do equilíbrio da margem do projeto', function () {
    setGoals(['gross_margin_pct' => 5]); // equilíbrio = ROAS 20, inalcançável para os dados de demonstração

    $data = attention();
    $roas = signal($data, 'meta_ads.roas_below_breakeven');

    expect($roas['status'])->toBe('critical')
        ->and($roas['explanation'])->toContain('equilíbrio de 20,00')
        ->and($roas['evidence']['break_even'])->toEqualWithDelta(20, 1e-9)
        ->and($data['statuses']['meta_ads:roas'])->toBe('critical')
        ->and($data['summary']['critical'])->toBeGreaterThanOrEqual(1);
});

it('não alerta ROAS quando a margem permite o retorno atual', function () {
    setGoals(['gross_margin_pct' => 100]); // equilíbrio = ROAS 1

    security()->set($this->tenant->id, $this->owner->id);
    $sum = fn (string $k) => (float) DB::table('metric_facts_daily')->where('integration_account_id', $this->metaAccount)
        ->where('metric_key', $k)->whereBetween('date', [$this->start->toDateString(), $this->end->toDateString()])->sum('value');
    $roas = $sum('meta_ads:conversion_value') / $sum('meta_ads:spend');
    security()->clear();

    $signal = signal(attention(), 'meta_ads.roas_below_breakeven');

    expect($signal === null)->toBe($roas >= 1.0);
});

it('usa a meta de CPA do projeto quando ela existe', function () {
    setGoals(['target_cpa' => 1]); // nenhum CPA real fica abaixo de R$ 1

    $cpa = signal(attention(), 'meta_ads.cpa_high');

    expect($cpa['status'])->toBe('critical')
        ->and($cpa['title'])->toBe('Custo por conversão acima da meta')
        ->and($cpa['evidence']['target'])->toEqualWithDelta(1, 1e-9);
});

it('detecta conversões que pararam de ser registradas (rastreamento quebrado)', function () {
    $last3 = [$this->end->subDays(2)->toDateString(), $this->end->toDateString()];
    setDaily($this->metaAccount, 'meta_ads:conversions', ...[...$last3, 0]);
    setDaily($this->metaAccount, 'meta_ads:link_clicks', ...[...$last3, 200]);
    setDaily($this->metaAccount, 'meta_ads:conversions', $this->end->subDays(5)->toDateString(), $this->end->subDays(3)->toDateString(), 5);

    $signal = signal(attention(), 'meta_ads.conversions_missing');

    expect($signal['status'])->toBe('critical')
        ->and($signal['explanation'])->toContain('Zero conversões nos últimos 3 dias')
        ->and($signal['suggestion'])->toContain('pixel');
});

it('detecta queda de eventos-chave do site sem queda de tráfego', function () {
    setDaily($this->ga4Account, 'ga4:key_events', $this->start->toDateString(), $this->end->toDateString(), 1);

    $signal = signal(attention(), 'ga4.key_events_drop');

    expect($signal['status'])->toBe('critical')
        ->and($signal['metric'])->toBe('ga4:key_events');
});

it('só roda regras das plataformas vinculadas ao projeto', function () {
    $rules = collect(attention()['signals'])->pluck('rule');

    expect($rules->filter(fn (string $r) => str_starts_with($r, 'instagram.') || str_starts_with($r, 'google_ads.')))->toBeEmpty();
});

it('marca como saudável a métrica avaliada sem problema', function () {
    setGoals(['target_cpa' => 1_000_000]);

    expect(attention()['statuses']['meta_ads:cpa'])->toBe('healthy');
});

it('ordena os sinais do mais urgente para o menos', function () {
    setGoals(['gross_margin_pct' => 5]);
    $severity = ['critical' => 3, 'attention' => 2, 'opportunity' => 1];
    $order = collect(attention()['signals'])->map(fn (array $s) => $severity[$s['status']])->all();

    expect($order)->toBe(collect($order)->sortDesc()->values()->all());
});

it('valida as metas do projeto e restringe a edição à equipe', function () {
    $this->actingAs($this->owner)->patchJson("/api/projects/{$this->project->id}", ['goals' => ['gross_margin_pct' => 150]], $this->headers)
        ->assertUnprocessable()->assertJsonValidationErrors('goals.gross_margin_pct');

    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->clear();

    // Cliente que não é membro do projeto nem o enxerga (RLS).
    $this->actingAs($client)->patchJson("/api/projects/{$this->project->id}", ['goals' => ['target_cpa' => 50]], $this->headers)
        ->assertNotFound();

    // Cliente membro enxerga, mas não pode editar.
    asTenant($this->tenant, fn () => ProjectMember::query()->create(['project_id' => $this->project->id, 'user_id' => $client->id]));
    security()->clear();

    $this->actingAs($client)->patchJson("/api/projects/{$this->project->id}", ['goals' => ['target_cpa' => 50]], $this->headers)
        ->assertForbidden();
});

it('devolve as metas no projeto', function () {
    setGoals(['gross_margin_pct' => 40, 'target_cpa' => 75.5]);

    $this->actingAs($this->owner)->getJson("/api/projects/{$this->project->id}", $this->headers)
        ->assertOk()
        ->assertJsonPath('data.goals.gross_margin_pct', 40)
        ->assertJsonPath('data.goals.target_cpa', 75.5)
        ->assertJsonPath('data.goals.target_roas', null);
});

it('não avalia projeto de outra agência', function () {
    [$other, $otherOwner] = tenantWithOwner('Agência B');
    security()->clear();

    $this->actingAs($otherOwner)->postJson("/api/projects/{$this->project->id}/attention", [
        'start' => $this->start->toDateString(), 'end' => $this->end->toDateString(),
    ], ['X-Tenant-Id' => $other->id])->assertNotFound();
});
