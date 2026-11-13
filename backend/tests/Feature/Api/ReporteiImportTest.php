<?php

declare(strict_types=1);

use App\Models\Import;
use App\Models\Project;
use App\Models\TimelineEvent;
use App\Support\Tenancy\TenantRole;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora']));
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    Http::preventStrayRequests();
});

function fakeReportei(): void
{
    Http::fake(function (Request $r) {
        $path = (string) parse_url($r->url(), PHP_URL_PATH);
        parse_str((string) parse_url($r->url(), PHP_URL_QUERY), $q);
        if (! $r->hasHeader('Authorization', 'Bearer token-do-reportei-1234567890')) {
            return Http::response(['message' => 'Unauthenticated'], 401);
        }

        return match ($path) {
            '/api/v2/companies/settings' => Http::response(['data' => ['name' => 'Agência Aurora']]),
            '/api/v2/projects' => Http::response(['data' => [['id' => 10, 'name' => 'Padaria Aurora'], ['id' => 11, 'name' => 'Loja Vértice']], 'meta' => ['last_page' => 1]]),
            '/api/v2/integrations' => Http::response(['data' => $q['project_id'] === '11' ? [['id' => 7, 'name' => 'Meta Ads', 'account_name' => 'Vértice BR']] : [], 'meta' => ['last_page' => 1]]),
            '/api/v2/timeline-events' => Http::response(['data' => $q['project_id'] === '11'
                ? [['title' => 'Lançamento <b>coleção</b>', 'content' => '<p>Nova coleção no ar</p>', 'date' => '2026-10-05']] : [], 'meta' => ['last_page' => 1]]),
            default => Http::response([], 404),
        };
    });
}

it('importa projetos, marcos e a lista de contas para reconectar, sem guardar o token', function () {
    fakeReportei();

    $import = $this->actingAs($this->owner)->postJson('/api/imports/reportei', ['token' => 'token-do-reportei-1234567890'], $this->headers)->assertAccepted()->json('data');
    $done = $this->actingAs($this->owner)->getJson("/api/imports/{$import['id']}", $this->headers)->assertOk()->json('data');

    expect($done['status'])->toBe('done')
        ->and($done['summary'])->toMatchArray(['projects_created' => 1, 'projects_existing' => 1, 'timeline_events' => 1])
        ->and($done['summary']['reconnect'])->toEqual([['project' => 'Loja Vértice', 'platform' => 'Meta Ads', 'account' => 'Vértice BR']]);

    $event = security()->run($this->tenant->id, $this->owner->id, fn () => TimelineEvent::query()->sole());
    expect($event->title)->toBe('Lançamento coleção')->and($event->description)->toBe('Nova coleção no ar')->and($event->occurred_on->toDateString())->toBe('2026-10-05');

    // Rodar de novo não duplica projetos.
    $this->actingAs($this->owner)->postJson('/api/imports/reportei', ['token' => 'token-do-reportei-1234567890'], $this->headers)->assertAccepted();
    expect(security()->run($this->tenant->id, $this->owner->id, fn () => Project::query()->count()))->toBe(2);

    $dump = json_encode(security()->run($this->tenant->id, $this->owner->id, fn () => DB::table('imports')->get()));
    expect($dump)->not->toContain('token-do-reportei');
});

it('explica token recusado e só deixa o administrador importar', function () {
    fakeReportei();
    $import = $this->actingAs($this->owner)->postJson('/api/imports/reportei', ['token' => 'token-errado-xxxxxxxxxxxxxxxx'], $this->headers)->json('data');

    $failed = $this->actingAs($this->owner)->getJson("/api/imports/{$import['id']}", $this->headers)->json('data');
    expect($failed['status'])->toBe('failed')->and($failed['error'])->toContain('recusou o token');

    $analyst = addUserToTenant($this->tenant, TenantRole::Analyst);
    security()->clear();
    $this->actingAs($analyst)->postJson('/api/imports/reportei', ['token' => 'token-do-reportei-1234567890'], $this->headers)->assertForbidden();
});

it('devolve o resumo como objeto mesmo vazio (na fila)', function () {
    $import = asTenant($this->tenant, fn () => Import::query()->create(['source' => 'reportei', 'status' => 'queued', 'summary' => [], 'created_by' => $this->owner->id]));

    expect($this->actingAs($this->owner)->getJson("/api/imports/{$import->id}", $this->headers)->assertOk()->getContent())->toContain('"summary":{}');
});
