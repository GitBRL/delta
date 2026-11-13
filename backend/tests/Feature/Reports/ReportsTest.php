<?php

declare(strict_types=1);

use App\Domain\Reports\Pdf\SnapshotPdf;
use App\Jobs\RenderSnapshotPdf;
use App\Models\AuditLog;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\ReportSnapshot;
use App\Support\Tenancy\TenantRole;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora', 'niche' => 'restaurante_delivery']));
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    security()->clear();

    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$meta->accounts->firstOrFail()->id]], $this->headers)->assertOk();

    Storage::fake('local');
    $this->pdfFails = false;
    Http::fake(['gotenberg:3000/*' => fn () => $this->pdfFails
        ? Http::response('erro', 500)
        : Http::response('%PDF-1.7 relatório de teste', 200, ['Content-Type' => 'application/pdf'])]);
});

function createReport(array $body = []): array
{
    $t = test();

    return $t->actingAs($t->owner)->postJson('/api/reports', ['project_id' => $t->project->id, 'title' => 'Relatório mensal', ...$body], $t->headers)
        ->assertCreated()->json('data');
}

function publish(string $reportId): array
{
    $t = test();

    return $t->actingAs($t->owner)->postJson("/api/reports/{$reportId}/snapshots", [], $t->headers)->assertCreated()->json('data');
}

it('lista os 6 modelos por nicho', function () {
    $templates = $this->actingAs($this->owner)->getJson('/api/report-templates', $this->headers)->assertOk()->json('data');

    expect(array_column($templates, 'key'))->toBe(['ecommerce', 'infoproduto', 'negocio_local', 'b2b', 'restaurante_delivery', 'redes_sociais']);
});

it('cria pelo modelo do nicho só com os canais do projeto', function () {
    $report = createReport();

    expect($report['template'])->toBe('restaurante_delivery')
        ->and(array_column($report['layout']['sections'], 'title'))->toBe(['Resumo do período', 'Meta Ads'])
        ->and(array_column($report['layout']['sections'][0]['blocks'], 'type'))->toBe(['text', 'kpis', 'attention'])
        ->and($report['period_preset'])->toBe('last_30')
        ->and($report['compare'])->toBe('previous_period');

    security()->set($this->tenant->id, $this->owner->id);
    expect(AuditLog::query()->where('action', 'report.created')->count())->toBe(1);
});

it('renderiza a prévia com valores, séries, semáforo e alterações ainda não salvas', function () {
    $report = createReport();

    $data = $this->actingAs($this->owner)->postJson("/api/reports/{$report['id']}/render", [
        'title' => 'Título novo',
        'period_preset' => 'last_7',
    ], $this->headers)->assertOk()->json('data');

    $meta = $data['sections'][1];
    $kpis = collect($meta['blocks'])->firstWhere('type', 'kpis');
    $chart = collect($meta['blocks'])->firstWhere('type', 'chart');
    $attention = collect($data['sections'][0]['blocks'])->firstWhere('type', 'attention');

    expect($data['title'])->toBe('Título novo')
        ->and($data['agency'])->toBe('Agência Aurora')
        ->and($data['comparison'])->not->toBeNull()
        ->and($kpis['metrics'][0]['key'])->toBe('meta_ads:spend')
        ->and($kpis['metrics'][0]['value'])->toBeGreaterThan(0)
        ->and($kpis['metrics'][0])->toHaveKey('status')
        ->and($chart['metric']['series'])->toHaveCount(7)
        ->and($chart['metric']['previous_series'])->toHaveCount(7)
        ->and($attention['summary'])->toHaveKeys(['critical', 'attention', 'opportunity']);
});

it('valida o layout bloco a bloco e aceita indicadores personalizados', function () {
    $report = createReport();
    $this->actingAs($this->owner)->postJson('/api/custom-metrics', [
        'name' => 'Custo por mil', 'formula' => 'meta_ads:spend / meta_ads:impressions * 1000', 'unit' => 'currency', 'direction' => 'lower_is_better', 'decimals' => 2,
    ], $this->headers)->assertCreated();

    $save = fn (array $layout) => $this->actingAs($this->owner)->putJson("/api/reports/{$report['id']}", [
        'title' => 'Relatório mensal', 'period_preset' => 'last_30', 'compare' => 'previous_period', 'layout' => $layout,
    ], $this->headers);

    $save(['sections' => [['title' => 'X', 'blocks' => [['type' => 'kpis', 'metrics' => ['meta_ads:nao_existe']], ['type' => 'video']]]]])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['layout.sections.0.blocks.0.metrics', 'layout.sections.0.blocks.1.type']);
    $save(['sections' => [['title' => '', 'blocks' => []]]])->assertUnprocessable()->assertJsonValidationErrors('layout.sections.0.title');

    $saved = $save(['sections' => [['id' => 'resumo', 'title' => 'Resumo', 'blocks' => [
        ['id' => 'k1', 'type' => 'kpis', 'metrics' => ['custom:custo_por_mil', 'meta_ads:spend'], 'lixo' => 'fora'],
        ['type' => 'text', 'content' => "Linha 1\r\nLinha 2"],
    ]]]])->assertOk()->json('data.layout');

    expect($saved['sections'][0]['id'])->toBe('resumo')
        ->and($saved['sections'][0]['blocks'][0])->toBe(['id' => 'k1', 'type' => 'kpis', 'metrics' => ['custom:custo_por_mil', 'meta_ads:spend']])
        ->and($saved['sections'][0]['blocks'][1]['content'])->toBe("Linha 1\nLinha 2")
        ->and($saved['sections'][0]['blocks'][1]['id'])->toMatch('/^b[a-z0-9]{8}$/');
});

it('publica uma versão imutável e gera o PDF na fila', function () {
    $report = createReport();
    $snapshot = publish($report['id']);

    expect($snapshot['pdf_status'])->toBe('pending') // o retorno é de antes do job; a fila "sync" já rodou
        ->and($snapshot['data']['sections'])->toHaveCount(2);

    $this->actingAs($this->owner)->getJson("/api/snapshots/{$snapshot['id']}", $this->headers)->assertJsonPath('data.pdf_status', 'ready');
    $pdf = $this->actingAs($this->owner)->get("/api/snapshots/{$snapshot['id']}/pdf", $this->headers)->assertOk();

    expect($pdf->headers->get('Content-Type'))->toBe('application/pdf')
        ->and($pdf->streamedContent())->toStartWith('%PDF');

    Http::assertSent(fn ($r) => str_contains($r->url(), 'gotenberg:3000/forms/chromium/convert/html')
        && collect($r->data())->contains(fn ($part) => ($part['filename'] ?? null) === 'index.html' && str_contains((string) $part['contents'], 'Padaria Aurora')));

    // Os números não mudam com o relatório: imutável também no banco.
    security()->run($this->tenant->id, $this->owner->id, function () use ($snapshot): void {
        expect(fn () => DB::transaction(fn () => DB::table('report_snapshots')->where('id', $snapshot['id'])->update(['data' => '{}'])))
            ->toThrow(QueryException::class, 'permission denied');
        expect(DB::table('report_snapshots')->where('id', $snapshot['id'])->update(['pdf_error' => null]))->toBe(1);
    });

    $this->actingAs($this->owner)->getJson("/api/reports/{$report['id']}/snapshots", $this->headers)->assertJsonCount(1, 'data');
});

it('marca o PDF como falho sem perder a publicação e permite tentar de novo', function () {
    Queue::fake();
    $snapshot = publish(createReport()['id']);
    Queue::assertPushedOn('render', RenderSnapshotPdf::class);

    $this->pdfFails = true;
    $job = security()->run($this->tenant->id, $this->owner->id, fn () => new RenderSnapshotPdf($snapshot['id']));
    security()->run($this->tenant->id, null, function () use ($job): void {
        expect(fn () => $job->handle(app(SnapshotPdf::class)))->toThrow(RuntimeException::class);
        $job->failed(new RuntimeException('HTTP 500'));
    });

    $this->actingAs($this->owner)->get("/api/snapshots/{$snapshot['id']}/pdf", $this->headers)->assertStatus(409)->assertJsonPath('status', 'failed');
    $this->actingAs($this->owner)->postJson("/api/snapshots/{$snapshot['id']}/pdf", [], $this->headers)->assertAccepted()->assertJsonPath('data.pdf_status', 'pending');

    $this->pdfFails = false;
    security()->run($this->tenant->id, null, fn () => $job->handle(app(SnapshotPdf::class)));
    $this->actingAs($this->owner)->get("/api/snapshots/{$snapshot['id']}/pdf", $this->headers)->assertOk();
});

it('monta o HTML do PDF com os números e escapa o texto da agência', function () {
    $report = createReport();
    $layout = $report['layout'];
    $layout['sections'][0]['blocks'][0]['content'] = "**Ótimo mês!** <script>alert(1)</script>\n\n- item";
    $this->actingAs($this->owner)->putJson("/api/reports/{$report['id']}", [
        'title' => 'Relatório mensal', 'period_preset' => 'last_30', 'compare' => 'previous_period', 'layout' => $layout,
    ], $this->headers)->assertOk();

    $snapshot = publish($report['id']);
    $html = security()->run($this->tenant->id, $this->owner->id, fn () => app(SnapshotPdf::class)->html(ReportSnapshot::query()->findOrFail($snapshot['id'])));

    expect($html)->toContain('<strong>Ótimo mês!</strong>')
        ->toContain('&lt;script&gt;')->not->toContain('<script>alert')
        ->toContain('<li>item</li>')
        ->toContain('Investimento')->toContain('<svg class="chart"')
        ->toContain('Padaria Aurora');
});

it('compartilha por link público com senha, conta as visitas e desativa', function () {
    $snapshot = publish(createReport()['id']);
    $link = $this->actingAs($this->owner)->postJson("/api/snapshots/{$snapshot['id']}/links", ['password' => 'aurora', 'expires_in_days' => 30], $this->headers)
        ->assertCreated()->assertJsonPath('data.protected', true);
    $token = substr((string) $link->json('url'), -40);
    expect($link->json('url'))->toBe('http://localhost:4300/r/'.$token);

    auth()->forgetGuards();
    security()->clear();

    $this->getJson("/api/public/reports/{$token}")->assertUnauthorized()->assertJsonPath('requires_password', true)->assertJsonPath('agency', 'Agência Aurora');
    $this->postJson("/api/public/reports/{$token}/unlock", ['password' => 'errada'])->assertUnprocessable()->assertJsonValidationErrors('password');
    $open = $this->postJson("/api/public/reports/{$token}/unlock", ['password' => 'aurora'])->assertOk()
        ->assertJsonPath('data.title', 'Relatório mensal')
        ->assertJsonPath('data.report.project.name', 'Padaria Aurora');

    $pdfUrl = (string) $open->json('data.pdf_url');
    expect($pdfUrl)->toStartWith('/api/public/reports/'.$token.'/pdf?expires=');
    expect($this->get($pdfUrl)->assertOk()->streamedContent())->toStartWith('%PDF');
    $this->get("/api/public/reports/{$token}/pdf")->assertForbidden(); // sem assinatura

    $links = $this->actingAs($this->owner)->getJson("/api/snapshots/{$snapshot['id']}/links", $this->headers)->json('data');
    expect($links[0]['view_count'])->toBe(1);

    $this->actingAs($this->owner)->deleteJson("/api/links/{$links[0]['id']}", [], $this->headers)->assertNoContent();
    auth()->forgetGuards();
    $this->getJson("/api/public/reports/{$token}")->assertStatus(410)->assertJsonPath('message', 'Este link foi desativado pela agência.');
    $this->getJson('/api/public/reports/'.str_repeat('a', 40))->assertNotFound();
});

it('link sem senha abre direto e expira', function () {
    $snapshot = publish(createReport()['id']);
    $token = substr((string) $this->actingAs($this->owner)->postJson("/api/snapshots/{$snapshot['id']}/links", ['expires_in_days' => 1], $this->headers)->json('url'), -40);
    auth()->forgetGuards();

    $this->getJson("/api/public/reports/{$token}")->assertOk()->assertJsonPath('data.report.title', 'Relatório mensal');

    security()->run($this->tenant->id, $this->owner->id, fn () => DB::table('share_links')->update(['expires_at' => DB::raw("now() - interval '1 minute'")]));
    $this->getJson("/api/public/reports/{$token}")->assertStatus(410);
});

it('cliente vê só as versões publicadas dos próprios projetos e não mexe no montador', function () {
    $report = createReport();
    $snapshot = publish($report['id']);
    $other = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Outro cliente']));
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->run($this->tenant->id, $this->owner->id, fn () => ProjectMember::query()->create(['project_id' => $this->project->id, 'user_id' => $client->id]));
    security()->clear();

    $this->actingAs($client)->getJson("/api/projects/{$this->project->id}/snapshots", $this->headers)->assertOk()->assertJsonCount(1, 'data');
    $this->actingAs($client)->getJson("/api/snapshots/{$snapshot['id']}", $this->headers)->assertOk();
    $this->actingAs($client)->getJson("/api/projects/{$other->id}/snapshots", $this->headers)->assertNotFound();
    $this->actingAs($client)->getJson('/api/reports', $this->headers)->assertForbidden();
    $this->actingAs($client)->postJson("/api/reports/{$report['id']}/snapshots", [], $this->headers)->assertForbidden();
    $this->actingAs($client)->postJson("/api/snapshots/{$snapshot['id']}/links", [], $this->headers)->assertForbidden();

    // E no banco: o cliente não enxerga relatórios de projetos alheios nem grava.
    security()->run($this->tenant->id, $client->id, function (): void {
        expect(DB::table('reports')->count())->toBe(1)
            ->and(DB::table('reports')->update(['title' => 'x']))->toBe(0)
            ->and(DB::table('share_links')->count())->toBe(0);
    });
});

it('isola relatórios entre agências', function () {
    $report = createReport();
    [$otherTenant, $otherOwner] = tenantWithOwner('Agência Boreal');
    security()->clear();

    $this->actingAs($otherOwner)->getJson("/api/reports/{$report['id']}", ['X-Tenant-Id' => $otherTenant->id])->assertNotFound();
    $this->actingAs($otherOwner)->getJson('/api/reports', ['X-Tenant-Id' => $otherTenant->id])->assertJsonCount(0, 'data');
});

it('compartilha um dashboard ao vivo, recalculado com cache curto e sem PDF', function () {
    $report = createReport();
    $link = $this->actingAs($this->owner)->postJson("/api/reports/{$report['id']}/links", [], $this->headers)
        ->assertCreated()->assertJsonPath('data.live', true)->assertJsonPath('data.report_id', $report['id']);
    $token = substr((string) $link->json('url'), -40);
    auth()->forgetGuards();
    security()->clear();

    $first = $this->getJson("/api/public/reports/{$token}")->assertOk()
        ->assertJsonPath('data.live', true)
        ->assertJsonPath('data.pdf_url', null)
        ->assertJsonPath('data.report.project.name', 'Padaria Aurora')
        ->json('data');
    expect($first['refreshed_at'])->not->toBeNull()
        ->and($first['report']['sections'][1]['blocks'][0]['metrics'][0]['value'])->toBeGreaterThan(0);

    // Mudança no relatório aparece depois do cache (5 min).
    security()->run($this->tenant->id, $this->owner->id, fn () => DB::table('reports')->where('id', $report['id'])->update(['title' => 'Painel da loja']));
    security()->clear();
    $this->getJson("/api/public/reports/{$token}")->assertJsonPath('data.report.title', 'Relatório mensal');
    $this->travel(6)->minutes();
    $this->getJson("/api/public/reports/{$token}")->assertJsonPath('data.title', 'Painel da loja')->assertJsonPath('data.report.title', 'Painel da loja');

    $this->get("/api/public/reports/{$token}/pdf")->assertForbidden(); // sem URL assinada
    $this->actingAs($this->owner)->getJson("/api/reports/{$report['id']}/links", $this->headers)->assertJsonCount(1, 'data')->assertJsonPath('data.0.view_count', 3);
});
