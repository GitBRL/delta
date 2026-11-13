<?php

declare(strict_types=1);

use App\Models\Project;
use App\Models\ProjectMember;
use App\Support\Tenancy\TenantRole;
use Illuminate\Support\Facades\Cache;

beforeEach(function () {
    Cache::flush();
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    [$this->aurora, $this->vertice, $this->empty] = asTenant($this->tenant, fn () => [
        Project::query()->create(['name' => 'Padaria Aurora', 'settings' => ['goals' => ['gross_margin_pct' => 20]]]),
        Project::query()->create(['name' => 'Loja Vértice']),
        Project::query()->create(['name' => 'Sem contas']),
    ]);
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    $google = connectSandbox($this->tenant, $this->owner, 'google_ads');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];

    $link = fn ($project, $connection) => $this->actingAs($this->owner)
        ->putJson("/api/projects/{$project->id}/accounts", ['account_ids' => [$connection->accounts->firstOrFail()->id]], $this->headers)->assertOk();
    $link($this->aurora, $meta);
    $link($this->vertice, $google);
});

it('consolida mídia, saúde, radar e projetos da agência', function () {
    $data = $this->actingAs($this->owner)->getJson('/api/overview?period_preset=last_30', $this->headers)->assertOk()->json('data');
    $kpis = collect($data['kpis'])->keyBy('key');
    $projects = collect($data['projects'])->keyBy('name');

    // Investimento combinado = Meta Ads (Aurora) + Google Ads (Vértice), cada um consultado no seu projeto.
    $metaSpend = collect($this->actingAs($this->owner)->postJson("/api/projects/{$this->aurora->id}/metrics/query", [
        'start' => $data['period']['start'], 'end' => $data['period']['end'], 'compare' => 'none', 'metrics' => ['meta_ads:spend'],
    ], $this->headers)->json('data.metrics'))->first()['value'];
    $googleSpend = collect($this->actingAs($this->owner)->postJson("/api/projects/{$this->vertice->id}/metrics/query", [
        'start' => $data['period']['start'], 'end' => $data['period']['end'], 'compare' => 'none', 'metrics' => ['google_ads:cost'],
    ], $this->headers)->json('data.metrics'))->first()['value'];

    expect($kpis->keys()->all())->toBe(['spend', 'conversions', 'cpa', 'roas'])
        ->and($kpis['spend']['value'])->toEqualWithDelta($metaSpend + $googleSpend, 0.05)
        ->and($kpis['cpa']['value'])->toEqualWithDelta($kpis['spend']['value'] / $kpis['conversions']['value'], 0.01)
        ->and($kpis['spend']['change_pct'])->not->toBeNull()
        ->and($data['health'])->toHaveKeys(['acquisition', 'engagement', 'conversion'])
        ->and($data['counts'])->toMatchArray(['projects' => 3, 'with_data' => 2])
        ->and($projects['Sem contas']['status'])->toBe('no_data')
        ->and($projects['Padaria Aurora']['providers'])->toBe(['meta_ads'])
        ->and(collect($data['projects'])->last()['name'])->toBe('Sem contas'); // ordenado do mais urgente

    foreach ($data['radar'] as $signal) {
        expect($signal)->toHaveKeys(['project', 'status', 'title', 'suggestion']);
    }
});

it('cliente vê só os próprios projetos, com cache separado', function () {
    $this->actingAs($this->owner)->getJson('/api/overview', $this->headers)->assertJsonPath('data.counts.projects', 3);

    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->run($this->tenant->id, $this->owner->id, fn () => ProjectMember::query()->create(['project_id' => $this->aurora->id, 'user_id' => $client->id]));
    security()->clear();

    $data = $this->actingAs($client)->getJson('/api/overview', $this->headers)->assertOk()->json('data');

    expect(array_column($data['projects'], 'name'))->toBe(['Padaria Aurora'])
        ->and($data['counts']['projects'])->toBe(1);
});

it('valida o período', function () {
    $this->actingAs($this->owner)->getJson('/api/overview?period_preset=ontem', $this->headers)->assertUnprocessable();
});
