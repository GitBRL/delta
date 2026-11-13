<?php

declare(strict_types=1);

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\DiscoveredAccount;
use App\Domain\Integrations\OAuth\OAuthTokens;
use App\Models\IntegrationConnection;
use App\Models\Project;
use App\Models\SheetSync;
use App\Support\Tenancy\TenantRole;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/*
| Sync para Google Sheets (ADR 0027).
*/

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora', 'niche' => 'ecommerce']));
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$meta->accounts->firstOrFail()->id]], $this->headers)->assertOk();
    config(['services.google.client_id' => 'c.apps.googleusercontent.com', 'services.google.client_secret' => 'segredo']);
});

function sheetsDestination(string $mode = 'live'): IntegrationConnection
{
    $t = test();
    $connection = security()->run($t->tenant->id, $t->owner->id, fn () => app(ConnectionManager::class)->connectDestination(
        'google_sheets', $mode, new OAuthTokens('ya29.sheets', '1//r', CarbonImmutable::now()->addHour()), new DiscoveredAccount('ana@aurora.com', 'ana@aurora.com', 'google_account'), $t->owner->id,
    ));
    security()->clear();

    return $connection;
}

function newSync(IntegrationConnection|string $destination, array $overrides = [])
{
    $t = test();

    return $t->actingAs($t->owner)->postJson('/api/sheet-syncs', [
        'project_id' => $t->project->id, 'connection_id' => is_string($destination) ? $destination : $destination->id, 'name' => 'Mídia diária',
        'metrics' => ['meta_ads:spend', 'meta_ads:cpa', 'meta_ads:ctr'], 'days' => 30, 'frequency' => 'daily', ...$overrides,
    ], $t->headers);
}

function storedSync(string $id): SheetSync
{
    $t = test();
    $sync = security()->run($t->tenant->id, null, fn () => SheetSync::query()->findOrFail($id));
    security()->clear();

    return $sync;
}

it('conecta o destino em demonstração pelo pop-up e exporta a prévia sem chamar o Google', function () {
    Http::fake();
    $start = $this->actingAs($this->owner)->get('/oauth/google_sheets/start?'.http_build_query(['tenant_id' => $this->tenant->id, 'mode' => 'sandbox', 'flow' => 'flow_'.str_repeat('s', 20), 'return' => 'popup']));
    parse_str((string) parse_url((string) $start->assertRedirect()->headers->get('Location'), PHP_URL_QUERY), $query);
    $this->actingAs($this->owner)->get('/oauth/google_sheets/callback?'.http_build_query(['state' => $query['state'], 'code' => 'demo_1']))->assertOk()->assertSee('"status":"success"', false);

    $destinations = $this->actingAs($this->owner)->getJson('/api/sync/destinations', $this->headers)->assertOk()
        ->assertJsonPath('meta.modes', ['sandbox', 'live'])->assertJsonPath('meta.live_note', null)->json('data');
    expect($destinations)->toHaveCount(1)->and($destinations[0]['label'])->toBe('Google Sheets (demonstração)')
        ->and(collect($this->actingAs($this->owner)->getJson('/api/connections', $this->headers)->json('data'))->pluck('provider')->all())->toBe(['meta_ads']);

    $id = newSync($destinations[0]['id'])->assertCreated()->json('data.id');
    $sync = $this->actingAs($this->owner)->getJson("/api/sheet-syncs/{$id}", $this->headers)->assertOk()->json('data');

    expect($sync['last_status'])->toBe('ok')
        ->and($sync['spreadsheet_url'])->toBeNull()
        ->and($sync['preview']['total_rows'])->toBe(30)
        ->and($sync['preview']['rows'][0])->toBe(['Data', 'Investimento', 'Custo por conversão (CPA)', 'CTR (link) (%)'])
        ->and($sync['preview']['rows'][30] ?? null)->toBeNull() // prévia: cabeçalho + 15 linhas
        ->and($sync['preview']['rows'][1][0])->toBe(ConnectionManager::yesterday()->subDays(29)->toDateString())
        ->and($sync['preview']['rows'][1][1])->toBeFloat();
    Http::assertNothingSent();
});

it('cria a planilha na primeira vez, depois só substitui os dados, e recria se foi apagada', function () {
    Http::fake([
        'sheets.googleapis.com/v4/spreadsheets' => Http::sequence()
            ->push(['spreadsheetId' => 'planilha-1', 'spreadsheetUrl' => 'https://docs.google.com/spreadsheets/d/planilha-1'])
            ->push(['spreadsheetId' => 'planilha-2', 'spreadsheetUrl' => 'https://docs.google.com/spreadsheets/d/planilha-2']),
        'sheets.googleapis.com/v4/spreadsheets/planilha-1/values/*:clear' => Http::sequence()->push([], 200)->push([], 200)->push(['error' => ['code' => 404]], 404),
        'sheets.googleapis.com/v4/spreadsheets/*' => Http::response([]),
    ]);
    $destination = sheetsDestination();

    $id = newSync($destination, ['days' => 7])->assertCreated()->json('data.id');
    expect(storedSync($id)->spreadsheet_id)->toBe('planilha-1');

    Http::assertSent(fn (Request $r) => $r->url() === 'https://sheets.googleapis.com/v4/spreadsheets' && $r['properties']['title'] === 'Delta · Padaria Aurora · Mídia diária' && $r->hasHeader('Authorization', 'Bearer ya29.sheets'));
    Http::assertSent(fn (Request $r) => $r->method() === 'PUT' && str_contains($r->url(), 'planilha-1/values/Dados!A1?valueInputOption=USER_ENTERED')
        && count($r['values']) === 8 && $r['values'][0][0] === 'Data' && is_float($r['values'][1][1]));

    // Segunda execução: a mesma planilha (limpa e regrava).
    $this->actingAs($this->owner)->postJson("/api/sheet-syncs/{$id}/run", [], $this->headers)->assertAccepted();
    expect(storedSync($id)->spreadsheet_id)->toBe('planilha-1');

    // Terceira: a planilha sumiu do Drive (404) → cria outra.
    $this->actingAs($this->owner)->postJson("/api/sheet-syncs/{$id}/run", [], $this->headers)->assertAccepted();
    $sync = storedSync($id);
    expect($sync->spreadsheet_id)->toBe('planilha-2')->and($sync->last_status)->toBe('ok');
});

it('registra o erro quando o Google recusa e não derruba a criação', function () {
    Http::fake(['sheets.googleapis.com/*' => Http::response(['error' => ['message' => 'The caller does not have permission']], 403)]);

    $id = newSync(sheetsDestination())->assertCreated()->json('data.id');
    $sync = storedSync($id);

    expect($sync->last_status)->toBe('error')->and($sync->last_error)->toContain('does not have permission');
});

it('valida destino, projeto e métricas, e só a equipe gerencia', function () {
    Http::fake();
    $destination = sheetsDestination('sandbox');
    $meta = security()->run($this->tenant->id, null, fn () => IntegrationConnection::query()->where('provider', 'meta_ads')->firstOrFail());
    security()->clear();

    newSync($meta)->assertUnprocessable()->assertJsonValidationErrors(['connection_id' => 'destino Google Sheets']);
    newSync($destination, ['metrics' => ['meta_ads:inventada']])->assertUnprocessable()->assertJsonValidationErrors(['metrics' => 'meta_ads:inventada']);
    newSync($destination, ['days' => 3])->assertUnprocessable()->assertJsonValidationErrors('days');

    [$other, $otherOwner] = tenantWithOwner('Agência Boreal');
    $foreign = asTenant($other, fn () => Project::query()->create(['name' => 'Secreto']));
    newSync($destination, ['project_id' => $foreign->id])->assertUnprocessable()->assertJsonValidationErrors('project_id');

    $client = addUserToTenant($this->tenant, TenantRole::Client);
    $this->actingAs($client)->getJson('/api/sheet-syncs', $this->headers)->assertForbidden();

    $id = newSync($destination)->assertCreated()->json('data.id');
    $this->actingAs($otherOwner)->getJson("/api/sheet-syncs/{$id}", ['X-Tenant-Id' => $other->id])->assertNotFound();
    expect(security()->run($this->tenant->id, $client->id, fn () => DB::table('sheet_syncs')->count()))->toBe(0);
});

it('o agendador dispara só as exportações vencidas, respeitando a frequência', function () {
    Http::fake();
    $destination = sheetsDestination('sandbox');
    $daily = newSync($destination)->json('data.id');
    $weekly = newSync($destination, ['name' => 'Semanal', 'frequency' => 'weekly'])->json('data.id');
    $paused = newSync($destination, ['name' => 'Pausada'])->json('data.id');
    $this->actingAs($this->owner)->patchJson("/api/sheet-syncs/{$paused}", ['active' => false], $this->headers)->assertOk();

    $due = fn (string $at) => collect(DB::select('select * from app.due_sheet_syncs(?)', [$at]))->pluck('sync_id')->all();
    expect($due(now()->toIso8601String()))->toBe([]) // acabaram de rodar

        ->and($due(now()->addDay()->toIso8601String()))->toBe([$daily])
        ->and($due(now()->addDays(7)->toIso8601String()))->toEqualCanonicalizing([$daily, $weekly]);

    DB::table('sheet_syncs')->where('id', $daily)->update(['last_run_at' => now()->subDays(2), 'last_preview' => null]);
    Artisan::call('sheets:sync-due');
    expect(storedSync($daily)->last_preview)->not->toBeNull()->and(storedSync($daily)->last_run_at->isToday())->toBeTrue();
});

it('conecta o Google Sheets real só com drive.file e identifica a conta', function () {
    Http::fake([
        'oauth2.googleapis.com/token' => Http::response(['access_token' => 'ya29.novo', 'refresh_token' => '1//rt', 'expires_in' => 3599, 'scope' => 'https://www.googleapis.com/auth/drive.file']),
        'www.googleapis.com/drive/v3/about*' => Http::response(['user' => ['emailAddress' => 'ana@aurora.com', 'displayName' => 'Ana']]),
    ]);

    $start = $this->actingAs($this->owner)->get('/oauth/google_sheets/start?'.http_build_query(['tenant_id' => $this->tenant->id, 'mode' => 'live', 'flow' => 'flow_'.str_repeat('g', 20), 'return' => 'popup']));
    parse_str((string) parse_url((string) $start->assertRedirect()->headers->get('Location'), PHP_URL_QUERY), $query);
    expect($query['scope'])->toBe('https://www.googleapis.com/auth/drive.file');

    $this->actingAs($this->owner)->get('/oauth/google_sheets/callback?'.http_build_query(['state' => $query['state'], 'code' => 'codigo']))->assertOk()->assertSee('"status":"success"', false);

    $connection = security()->run($this->tenant->id, null, fn () => IntegrationConnection::query()->where('provider', 'google_sheets')->sole());
    expect($connection->label)->toBe('Google Sheets · ana@aurora.com')->and($connection->status)->toBe('active')
        ->and($connection->credentials['refresh_token'] ?? null)->toBe('1//rt');
});

it('a sincronização diária das conexões ignora os destinos', function () {
    sheetsDestination('sandbox');

    expect(Artisan::call('connections:sync-daily'))->toBe(0);
});
