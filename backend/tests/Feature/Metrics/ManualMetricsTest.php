<?php

declare(strict_types=1);

use App\Domain\Metrics\Manual\ManualImport;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Support\Tenancy\TenantRole;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora']));
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$meta->accounts->firstOrFail()->id]], $this->headers)->assertOk();
});

function manualMetric(array $body = []): array
{
    $t = test();

    return $t->actingAs($t->owner)->postJson('/api/manual-metrics', [
        'name' => 'Vendas na loja', 'unit' => 'currency', 'direction' => 'higher_is_better', 'decimals' => 2, 'aggregation' => 'sum', ...$body,
    ], $t->headers)->assertCreated()->json('data');
}

function queryManual(array $metrics, string $start, string $end): array
{
    $t = test();

    return collect($t->actingAs($t->owner)->postJson("/api/projects/{$t->project->id}/metrics/query", [
        'start' => $start, 'end' => $end, 'compare' => 'none', 'metrics' => $metrics,
    ], $t->headers)->assertOk()->json('data.metrics'))->pluck('value', 'key')->all();
}

it('define a métrica, lança valores e consulta como qualquer outra', function () {
    $sales = manualMetric();
    $base = manualMetric(['name' => 'Clientes ativos', 'unit' => 'count', 'decimals' => 0, 'aggregation' => 'last']);
    expect($sales['key'])->toBe('manual:vendas_na_loja');

    $this->actingAs($this->owner)->postJson('/api/manual-metrics', ['name' => 'Vendas na loja', 'unit' => 'currency', 'direction' => 'higher_is_better', 'decimals' => 2, 'aggregation' => 'sum'], $this->headers)
        ->assertUnprocessable()->assertJsonValidationErrors('name');

    $save = fn (string $id, array $entries) => $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/manual-values", ['metric_id' => $id, 'entries' => $entries], $this->headers);
    $save($sales['id'], [['date' => '2026-10-01', 'value' => 1000], ['date' => '2026-10-02', 'value' => 250.5], ['date' => '2026-10-03', 'value' => 99]])->assertOk()->assertJsonPath('data.saved', 3);
    $save($sales['id'], [['date' => '2026-10-03', 'value' => null]])->assertJsonPath('data.deleted', 1);
    $save($base['id'], [['date' => '2026-10-01', 'value' => 120], ['date' => '2026-10-02', 'value' => 125]])->assertOk();

    $v = queryManual(['manual:vendas_na_loja', 'manual:clientes_ativos'], '2026-10-01', '2026-10-31');
    expect($v['manual:vendas_na_loja'])->toEqual(1250.5)->and($v['manual:clientes_ativos'])->toEqual(125);

    expect(queryManual(['manual:vendas_na_loja'], '2026-09-01', '2026-09-30')['manual:vendas_na_loja'])->toBeNull();
});

it('entra em indicador personalizado e no relatório', function () {
    $sales = manualMetric();
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/manual-values", ['metric_id' => $sales['id'], 'entries' => [['date' => '2026-10-15', 'value' => 5000]]], $this->headers)->assertOk();

    $this->actingAs($this->owner)->postJson('/api/custom-metrics', [
        'name' => 'ROAS real', 'formula' => 'manual:vendas_na_loja / meta_ads:spend', 'unit' => 'decimal', 'direction' => 'higher_is_better', 'decimals' => 2,
    ], $this->headers)->assertCreated();

    $v = queryManual(['custom:roas_real', 'meta_ads:spend'], '2026-10-01', '2026-10-31');
    expect($v['custom:roas_real'])->toEqualWithDelta(5000 / $v['meta_ads:spend'], 0.001);

    $report = $this->actingAs($this->owner)->postJson('/api/reports', ['project_id' => $this->project->id, 'title' => 'Mensal'], $this->headers)->json('data');
    $data = $this->actingAs($this->owner)->postJson("/api/reports/{$report['id']}/render", [
        'period_preset' => 'custom', 'period_start' => '2026-10-01', 'period_end' => '2026-10-31',
        'layout' => ['sections' => [['title' => 'Loja', 'blocks' => [['type' => 'kpis', 'metrics' => ['manual:vendas_na_loja', 'custom:roas_real']]]]]],
    ], $this->headers)->assertOk()->json('data');

    expect($data['sections'][0]['blocks'][0]['metrics'][0])->toMatchArray(['key' => 'manual:vendas_na_loja', 'value' => 5000, 'provider_name' => 'Fonte manual']);

    $this->actingAs($this->owner)->deleteJson("/api/manual-metrics/{$sales['id']}", [], $this->headers)
        ->assertUnprocessable()->assertJsonValidationErrors(['metric' => 'ROAS real']);
});

it('importa planilha em formato brasileiro e aponta os erros por linha', function () {
    $sales = manualMetric();
    $csv = "Data;Valor\n01/10/2026;1.234,56\n2026-10-02;R$ 10,00\n31/02/2026;5\n03/10/2026;abc\n04/10/2026,2.000,00";

    $result = $this->actingAs($this->owner)->postJson("/api/projects/{$this->project->id}/manual-values/import", ['metric_id' => $sales['id'], 'csv' => $csv], $this->headers)
        ->assertOk()->json('data');

    expect($result['saved'])->toBe(3)
        ->and(array_column($result['errors'], 'line'))->toBe([4, 5])
        ->and(queryManual(['manual:vendas_na_loja'], '2026-10-01', '2026-10-31')['manual:vendas_na_loja'])->toEqual(3244.56);

    expect(ManualImport::number('1,234.50'))->toBe(1234.5)->and(ManualImport::number('12,5'))->toBe(12.5)->and(ManualImport::date('2026-13-01'))->toBeNull();
});

it('cliente lê os valores do próprio projeto, mas não grava', function () {
    $sales = manualMetric();
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->run($this->tenant->id, $this->owner->id, fn () => ProjectMember::query()->create(['project_id' => $this->project->id, 'user_id' => $client->id]));
    security()->clear();
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/manual-values", ['metric_id' => $sales['id'], 'entries' => [['date' => '2026-10-01', 'value' => 10]]], $this->headers)->assertOk();

    $this->actingAs($client)->getJson("/api/projects/{$this->project->id}/manual-values?metric_id={$sales['id']}", $this->headers)->assertOk()->assertJsonCount(1, 'data');
    $this->actingAs($client)->putJson("/api/projects/{$this->project->id}/manual-values", ['metric_id' => $sales['id'], 'entries' => [['date' => '2026-10-02', 'value' => 1]]], $this->headers)->assertForbidden();

    security()->run($this->tenant->id, $client->id, function () use ($sales): void {
        expect(fn () => DB::transaction(fn () => DB::table('manual_metric_values')->insert([
            'manual_metric_id' => $sales['id'], 'project_id' => $this->project->id, 'date' => '2026-10-05', 'value' => 1,
        ])))->toThrow(QueryException::class, 'row-level security');
    });
});
