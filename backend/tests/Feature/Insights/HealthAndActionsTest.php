<?php

declare(strict_types=1);

use App\Models\Project;
use App\Models\TimelineEvent;
use App\Support\Tenancy\TenantRole;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-11 10:00', 'America/Sao_Paulo'));
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora']));
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$meta->accounts->firstOrFail()->id]], $this->headers)->assertOk();
    $this->leads = $this->actingAs($this->owner)->postJson('/api/manual-metrics', ['name' => 'Leads', 'unit' => 'count', 'direction' => 'higher_is_better', 'decimals' => 0, 'aggregation' => 'sum'], $this->headers)->json('data');
});

it('calcula a saúde do projeto com fatores e guarda o histórico diário', function () {
    $health = $this->actingAs($this->owner)->getJson("/api/projects/{$this->project->id}/health", $this->headers)->assertOk()->json('data');

    expect($health['score'])->toBe(max(0, 100 + array_sum(array_column($health['factors'], 'impact'))))
        ->and($health['level'])->toBeIn(['good', 'fair', 'poor'])
        ->and($health['history'])->toBe([]);

    $this->artisan('insights:daily')->expectsOutputToContain('1 nota(s) de saúde')->assertSuccessful();
    $history = $this->actingAs($this->owner)->getJson("/api/projects/{$this->project->id}/health", $this->headers)->json('data.history');
    expect($history)->toHaveCount(1)->and($history[0]['date'])->toBe('2026-11-11');
});

it('transforma sugestão em ação e mede o impacto 14 dias depois de aplicada', function () {
    $entries = [];
    for ($d = 1; $d <= 14; $d++) {
        $entries[] = ['date' => CarbonImmutable::parse('2026-11-11')->subDays($d)->toDateString(), 'value' => 10];   // antes: 140
        $entries[] = ['date' => CarbonImmutable::parse('2026-11-11')->addDays($d - 1)->toDateString(), 'value' => 15]; // depois: 210
    }
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/manual-values", ['metric_id' => $this->leads['id'], 'entries' => $entries], $this->headers)->assertOk();

    $action = $this->actingAs($this->owner)->postJson("/api/projects/{$this->project->id}/actions", [
        'rule' => 'history.manual:leads', 'metric_key' => 'manual:leads', 'title' => 'Renovar criativos', 'suggestion' => 'Trocar os 3 anúncios mais antigos.',
        'assignee_id' => $this->owner->id, 'due_on' => '2026-11-15',
    ], $this->headers)->assertCreated()->assertJsonPath('data.status', 'open')->assertJsonPath('data.assignee.name', $this->owner->name)->json('data');

    $done = $this->actingAs($this->owner)->patchJson("/api/actions/{$action['id']}", ['status' => 'done'], $this->headers)->assertOk()->json('data');
    expect($done['baseline'])->toMatchArray(['value' => 140, 'start' => '2026-10-28', 'end' => '2026-11-10'])->and($done['outcome'])->toBeNull();

    $this->artisan('insights:daily')->expectsOutputToContain('0 ação(ões) medida(s)'); // janela ainda aberta
    $this->travel(15)->days();
    $this->artisan('insights:daily')->expectsOutputToContain('1 ação(ões) medida(s)')->assertSuccessful();

    $measured = $this->actingAs($this->owner)->getJson("/api/projects/{$this->project->id}/actions", $this->headers)->json('data.0');
    expect($measured['outcome'])->toMatchArray(['value' => 210, 'change_pct' => 50, 'improved' => true]);

    $titles = security()->run($this->tenant->id, $this->owner->id, fn () => TimelineEvent::query()->whereIn('type', ['action_applied', 'action_result'])->orderBy('created_at')->pluck('title')->all());
    expect($titles)->toBe(['Ação aplicada: Renovar criativos', 'Resultado: Leads subiu 50,0% após "Renovar criativos"']);
});

it('pede o motivo ao descartar e só aceita responsável da equipe', function () {
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->clear();

    $this->actingAs($this->owner)->postJson("/api/projects/{$this->project->id}/actions", ['metric_key' => 'manual:leads', 'title' => 'X teste', 'assignee_id' => $client->id], $this->headers)
        ->assertUnprocessable()->assertJsonValidationErrors('assignee_id');
    $id = $this->actingAs($this->owner)->postJson("/api/projects/{$this->project->id}/actions", ['metric_key' => 'manual:leads', 'title' => 'Revisar oferta'], $this->headers)->json('data.id');

    $this->actingAs($this->owner)->patchJson("/api/actions/{$id}", ['status' => 'dismissed'], $this->headers)->assertUnprocessable()->assertJsonValidationErrors('dismissed_reason');
    $this->actingAs($this->owner)->patchJson("/api/actions/{$id}", ['status' => 'dismissed', 'dismissed_reason' => 'Cliente já está trocando o site', 'feedback' => 'not_useful'], $this->headers)
        ->assertOk()->assertJsonPath('data.status', 'dismissed')->assertJsonPath('data.feedback', 'not_useful');

    expect(security()->run($this->tenant->id, $this->owner->id, fn () => DB::table('actions')->count()))->toBe(1);
});
