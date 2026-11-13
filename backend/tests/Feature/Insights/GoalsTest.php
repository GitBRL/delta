<?php

declare(strict_types=1);

use App\Mail\GoalAlertMail;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\TimelineEvent;
use App\Support\Tenancy\TenantRole;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-11 10:00', 'America/Sao_Paulo'));
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora']));
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    Mail::fake();

    $metric = fn (string $name, string $aggregation) => $this->actingAs($this->owner)->postJson('/api/manual-metrics', [
        'name' => $name, 'unit' => $aggregation === 'sum' ? 'count' : 'currency', 'direction' => $aggregation === 'sum' ? 'higher_is_better' : 'lower_is_better', 'decimals' => 0, 'aggregation' => $aggregation,
    ], $this->headers)->json('data');
    $this->leads = $metric('Leads', 'sum');
    $this->cpl = $metric('Custo por lead', 'last');
});

function lancar(array $metric, array $entries): void
{
    $t = test();
    $t->actingAs($t->owner)->putJson("/api/projects/{$t->project->id}/manual-values", ['metric_id' => $metric['id'], 'entries' => $entries], $t->headers)->assertOk();
}

function meta(string $key, string $comparison, float $target)
{
    $t = test();

    return $t->actingAs($t->owner)->postJson("/api/projects/{$t->project->id}/goals", ['metric_key' => $key, 'comparison' => $comparison, 'target' => $target, 'period' => 'month'], $t->headers);
}

it('mede ritmo e projeção de metas que acumulam', function (float $soFar, string $status) {
    lancar($this->leads, [['date' => '2026-11-05', 'value' => $soFar]]);
    $progress = meta('manual:leads', 'at_least', 100)->assertCreated()->json('data.progress');

    // 10 dias de 30 com dados (até ontem): projeção = valor ÷ 10 × 30
    expect($progress['status'])->toBe($status)
        ->and($progress['days'])->toBe(['elapsed' => 10, 'total' => 30])
        ->and($progress['projection'])->toEqual($soFar * 3)
        ->and($progress['expected'])->toEqualWithDelta(33.33, 0.01)
        ->and($progress['period']['label'])->toBe('novembro de 2026');
})->with([[40.0, 'on_track'], [31.0, 'at_risk'], [20.0, 'off_track'], [120.0, 'achieved']]);

it('compara metas de nível pelo valor atual, com tolerância de 10%', function (float $cpl, string $status) {
    lancar($this->cpl, [['date' => '2026-11-09', 'value' => $cpl]]);

    expect(meta('manual:custo_por_lead', 'at_most', 50)->json('data.progress.status'))->toBe($status);
})->with([[45.0, 'on_track'], [54.0, 'at_risk'], [60.0, 'off_track']]);

it('fecha o mês no dia 1 e avisa a equipe só quando o estado muda', function () {
    lancar($this->leads, [['date' => '2026-11-05', 'value' => 20]]);
    meta('manual:leads', 'at_least', 100)->assertCreated();
    addUserToTenant($this->tenant, TenantRole::Client); // cliente não recebe alerta interno
    security()->clear();

    $this->artisan('goals:evaluate')->expectsOutputToContain('1 alerta(s)')->assertSuccessful();
    $this->artisan('goals:evaluate')->expectsOutputToContain('0 alerta(s)')->assertSuccessful();
    Mail::assertQueued(GoalAlertMail::class, fn (GoalAlertMail $m) => $m->hasTo($this->owner->email) && count($m->to) === 1 && str_contains($m->alerts[0]['text'], 'projeção de 60'));

    $this->travelTo(CarbonImmutable::parse('2026-12-01 10:00', 'America/Sao_Paulo'));
    lancar($this->leads, [['date' => '2026-11-28', 'value' => 90]]);
    $this->artisan('goals:evaluate')->expectsOutputToContain('1 alerta(s)')->assertSuccessful(); // novembro fechou com 110: batida

    $types = security()->run($this->tenant->id, $this->owner->id, fn () => TimelineEvent::query()->orderBy('created_at')->pluck('type')->all());
    expect($types)->toBe(['goal_off_track', 'goal_achieved']);
});

it('linha do tempo com marcos manuais e automáticos', function () {
    Storage::fake('local');
    Http::fake(['gotenberg:3000/*' => Http::response('%PDF-1.7', 200)]);
    $report = $this->actingAs($this->owner)->postJson('/api/reports', ['project_id' => $this->project->id, 'title' => 'Mensal'], $this->headers)->json('data');
    $this->actingAs($this->owner)->postJson("/api/reports/{$report['id']}/snapshots", [], $this->headers)->assertCreated();

    $this->actingAs($this->owner)->postJson("/api/projects/{$this->project->id}/timeline", ['title' => 'Campanha de Black Friday no ar', 'occurred_on' => '2026-11-10'], $this->headers)->assertCreated();

    $events = $this->actingAs($this->owner)->getJson("/api/projects/{$this->project->id}/timeline", $this->headers)->assertOk()->json('data');
    expect(array_column($events, 'type'))->toContain('manual', 'report_published');

    $auto = collect($events)->firstWhere('type', 'report_published');
    $this->actingAs($this->owner)->deleteJson("/api/timeline/{$auto['id']}", [], $this->headers)->assertUnprocessable();
});

it('cliente vê as metas do próprio projeto e não cria', function () {
    meta('manual:leads', 'at_least', 100)->assertCreated();
    meta('manual:nao_existe', 'at_least', 1)->assertUnprocessable()->assertJsonValidationErrors('metric_key');
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->run($this->tenant->id, $this->owner->id, fn () => ProjectMember::query()->create(['project_id' => $this->project->id, 'user_id' => $client->id]));
    security()->clear();

    $this->actingAs($client)->getJson('/api/goals', $this->headers)->assertOk()->assertJsonCount(1, 'data');
    $this->actingAs($client)->postJson("/api/projects/{$this->project->id}/goals", ['metric_key' => 'manual:leads', 'comparison' => 'at_least', 'target' => 1, 'period' => 'month'], $this->headers)->assertForbidden();
});
