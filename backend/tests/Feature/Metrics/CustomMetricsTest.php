<?php

declare(strict_types=1);

use App\Domain\Integrations\ConnectionManager;
use App\Models\CustomMetric;
use App\Models\Project;
use App\Support\Tenancy\TenantRole;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência A');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Loja Aurora']));
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    $ga4 = connectSandbox($this->tenant, $this->owner, 'ga4');
    security()->clear();

    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", [
        'account_ids' => [$meta->accounts->firstOrFail()->id, $ga4->accounts->firstOrFail()->id],
    ], $this->headers)->assertOk();

    $this->end = ConnectionManager::yesterday();
    $this->start = $this->end->subDays(29);
});

function indicator(array $overrides = []): array
{
    return [
        'name' => 'ROAS combinado',
        'description' => 'Receita das duas plataformas sobre o investimento nelas.',
        'formula' => 'sum(meta_ads:conversion_value, google_ads:conversion_value) / sum(meta_ads:spend, google_ads:cost)',
        'unit' => 'decimal',
        'direction' => 'higher_is_better',
        'decimals' => 2,
        ...$overrides,
    ];
}

function createIndicator(array $overrides = []): array
{
    $t = test();

    return $t->actingAs($t->owner)->postJson('/api/custom-metrics', indicator($overrides), $t->headers)->assertCreated()->json('data');
}

function queryProject(array $metrics, string $compare = 'none'): array
{
    $t = test();

    return $t->actingAs($t->owner)->postJson("/api/projects/{$t->project->id}/metrics/query", [
        'start' => $t->start->toDateString(), 'end' => $t->end->toDateString(), 'compare' => $compare, 'metrics' => $metrics,
    ], $t->headers)->assertOk()->json('data.metrics');
}

it('cria indicador com chave estável derivada do nome e as plataformas de que depende', function () {
    $data = createIndicator();

    expect($data['key'])->toBe('custom:roas_combinado')
        ->and($data['providers'])->toEqualCanonicalizing(['meta_ads', 'google_ads']);
});

it('calcula o indicador na consulta do projeto, mesmo sem uma das plataformas', function () {
    createIndicator();
    $metrics = collect(queryProject(['custom:roas_combinado', 'meta_ads:roas']))->keyBy('key');

    // O projeto não tem Google Ads: sum() ignora a plataforma ausente e o resultado é o ROAS da Meta.
    expect($metrics['custom:roas_combinado']['value'])->toEqualWithDelta($metrics['meta_ads:roas']['value'], 1e-6)
        ->and($metrics['custom:roas_combinado']['label'])->toBe('ROAS combinado')
        ->and($metrics['custom:roas_combinado']['direction'])->toBe('higher_is_better');
});

it('permite indicador que usa outro indicador e calcula pela razão dos totais', function () {
    createIndicator(['name' => 'Investimento total', 'formula' => 'sum(meta_ads:spend, google_ads:cost)', 'unit' => 'currency', 'direction' => 'neutral']);
    createIndicator(['name' => 'Custo por sessão', 'formula' => 'custom:investimento_total / ga4:sessions', 'unit' => 'currency', 'direction' => 'lower_is_better']);

    $m = collect(queryProject(['custom:custo_por_sessao', 'meta_ads:spend', 'ga4:sessions']))->keyBy('key');

    expect($m['custom:custo_por_sessao']['value'])->toEqualWithDelta($m['meta_ads:spend']['value'] / $m['ga4:sessions']['value'], 1e-6);
});

it('explica fórmulas inválidas', function (array $overrides, string $message) {
    $this->actingAs($this->owner)
        ->postJson('/api/custom-metrics', indicator($overrides), $this->headers)
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['formula' => $message]);
})->with([
    'sintaxe' => [['formula' => 'meta_ads:spend / (meta_ads:conversions'], 'parêntese'],
    'métrica inexistente' => [['formula' => 'meta_ads:spend / meta_ads:vendas'], 'desconhecido: meta_ads:vendas'],
    'sem métrica' => [['formula' => '2 + 2'], 'ao menos uma métrica'],
    'função inexistente' => [['formula' => 'media(meta_ads:spend)'], 'Função desconhecida'],
]);

it('impede ciclos entre indicadores, inclusive criados por edição', function () {
    $a = createIndicator(['name' => 'Indicador A', 'formula' => 'meta_ads:spend * 2']);
    createIndicator(['name' => 'Indicador B', 'formula' => 'custom:indicador_a + 1']);

    $this->actingAs($this->owner)
        ->putJson("/api/custom-metrics/{$a['id']}", indicator(['name' => 'Indicador A', 'formula' => 'custom:indicador_b * 2']), $this->headers)
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['formula' => 'Ciclo entre indicadores']);

    $this->actingAs($this->owner)
        ->putJson("/api/custom-metrics/{$a['id']}", indicator(['name' => 'Indicador A', 'formula' => 'custom:indicador_a * 2']), $this->headers)
        ->assertUnprocessable()
        ->assertJsonValidationErrors('formula');
});

it('mantém a chave ao renomear', function () {
    $created = createIndicator();

    $this->actingAs($this->owner)
        ->putJson("/api/custom-metrics/{$created['id']}", indicator(['name' => 'Retorno combinado']), $this->headers)
        ->assertOk()
        ->assertJsonPath('data.key', 'custom:roas_combinado')
        ->assertJsonPath('data.name', 'Retorno combinado');
});

it('recusa nome repetido', function () {
    createIndicator();

    $this->actingAs($this->owner)
        ->postJson('/api/custom-metrics', indicator(), $this->headers)
        ->assertUnprocessable()
        ->assertJsonValidationErrors('name');
});

it('não exclui indicador usado por outro e diz qual', function () {
    $base = createIndicator(['name' => 'Investimento total', 'formula' => 'sum(meta_ads:spend, google_ads:cost)']);
    createIndicator(['name' => 'Custo por sessão', 'formula' => 'custom:investimento_total / ga4:sessions']);

    $this->actingAs($this->owner)
        ->deleteJson("/api/custom-metrics/{$base['id']}", [], $this->headers)
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['id' => 'Custo por sessão']);
});

it('exclui indicador sem dependentes', function () {
    $created = createIndicator();

    $this->actingAs($this->owner)->deleteJson("/api/custom-metrics/{$created['id']}", [], $this->headers)->assertNoContent();
    $this->actingAs($this->owner)->getJson('/api/custom-metrics', $this->headers)->assertJsonCount(0, 'data');
});

it('pré-visualiza a fórmula sem salvar', function () {
    $item = $this->actingAs($this->owner)->postJson('/api/custom-metrics/preview', [
        ...indicator(),
        'project_id' => $this->project->id,
        'start' => $this->start->toDateString(),
        'end' => $this->end->toDateString(),
        'compare' => 'previous_period',
    ], $this->headers)->assertOk()->json('data');

    expect($item['value'])->not->toBeNull()
        ->and($item['previous'])->not->toBeNull()
        ->and($item['series'])->toHaveCount(30)
        ->and(security()->run($this->tenant->id, null, fn () => CustomMetric::query()->count()))->toBe(0);
});

it('mostra o erro de fórmula no preview', function () {
    $this->actingAs($this->owner)->postJson('/api/custom-metrics/preview', [
        ...indicator(['formula' => 'meta_ads:spend /']),
        'project_id' => $this->project->id,
        'start' => $this->start->toDateString(),
        'end' => $this->end->toDateString(),
        'compare' => 'none',
    ], $this->headers)->assertUnprocessable()->assertJsonValidationErrors('formula');
});

it('isola indicadores entre agências', function () {
    createIndicator();
    [$other, $otherOwner] = tenantWithOwner('Agência B');
    $foreignProject = asTenant($other, fn () => Project::query()->create(['name' => 'Projeto B']));
    security()->clear();

    $headersB = ['X-Tenant-Id' => $other->id];
    $this->actingAs($otherOwner)->getJson('/api/custom-metrics', $headersB)->assertOk()->assertJsonCount(0, 'data');

    // A outra agência não consegue usar a chave da agência A numa consulta.
    $this->actingAs($otherOwner)->postJson("/api/projects/{$foreignProject->id}/metrics/query", [
        'start' => $this->start->toDateString(), 'end' => $this->end->toDateString(), 'compare' => 'none', 'metrics' => ['custom:roas_combinado'],
    ], $headersB)->assertUnprocessable()->assertJsonValidationErrors('metrics.0');
});

it('deixa o cliente ver indicadores, mas não criar nem excluir', function () {
    $created = createIndicator();
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->clear();

    $this->actingAs($client)->getJson('/api/custom-metrics', $this->headers)->assertOk()->assertJsonCount(1, 'data');
    $this->actingAs($client)->postJson('/api/custom-metrics', indicator(['name' => 'Outro']), $this->headers)->assertForbidden();
    $this->actingAs($client)->deleteJson("/api/custom-metrics/{$created['id']}", [], $this->headers)->assertForbidden();
});

it('oferece modelos prontos válidos', function () {
    $templates = $this->actingAs($this->owner)->getJson('/api/custom-metrics/templates', $this->headers)->assertOk()->json('data');

    expect($templates)->not->toBeEmpty();

    foreach ($templates as $template) {
        $this->actingAs($this->owner)
            ->postJson('/api/custom-metrics', $template, $this->headers)
            ->assertCreated();
    }
});
