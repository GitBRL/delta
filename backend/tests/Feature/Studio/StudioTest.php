<?php

declare(strict_types=1);

use App\Domain\Ai\AiReply;
use App\Domain\Ai\AiWriter;
use App\Models\Project;
use App\Support\Tenancy\TenantRole;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/*
| Studio (ADR 0029): apresentação gerada por IA, números calculados pelo Delta.
*/

/** IA falsa do Studio: devolve as respostas na ordem e guarda o que recebeu. */
final class StudioFakeWriter implements AiWriter
{
    /** @var list<array{system: string, messages: list<array{role: string, content: string}>}> */
    public array $calls = [];

    /** @param list<string> $replies */
    public function __construct(public array $replies) {}

    public function generate(string $apiKey, string $system, array $messages): AiReply
    {
        $this->calls[] = ['system' => $system, 'messages' => $messages];

        return new AiReply(array_shift($this->replies) ?? '{}', 2000, 800);
    }
}

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora', 'niche' => 'restaurante_delivery']));
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$meta->accounts->firstOrFail()->id]], $this->headers)->assertOk();
});

function studioWriter(array $replies): StudioFakeWriter
{
    $fake = new StudioFakeWriter($replies);
    app()->instance(AiWriter::class, $fake);

    return $fake;
}

function studioAi(): void
{
    $t = test();
    $t->actingAs($t->owner)->putJson('/api/ai', ['api_key' => 'sk-ant-api03-'.str_repeat('x', 30), 'enabled' => true, 'monthly_token_budget' => 2_000_000], $t->headers)->assertOk();
}

function deck(array $overrides = []): string
{
    return "```json\n".json_encode([
        'title' => 'Resultados de outubro',
        'slides' => [
            ['title' => 'Resumo executivo', 'text' => 'O mês foi de **crescimento** em vendas, com custo controlado.', 'metrics' => ['meta_ads:spend', 'meta_ads:cpa', 'google_ads:cost'], 'chart' => null, 'table' => []],
            ['title' => 'Evolução das conversões', 'text' => '', 'metrics' => [], 'chart' => 'meta_ads:conversions', 'table' => ['meta_ads:ctr', 'meta_ads:cpm', 'inventada:x']],
            ['title' => 'Slide vazio', 'text' => '', 'metrics' => ['ga4:sessions'], 'chart' => null, 'table' => []],
            ['title' => 'Próximos passos', 'text' => "- Testar novos criativos\n- Revisar públicos", 'metrics' => [], 'chart' => null, 'table' => []],
        ],
        ...$overrides,
    ], JSON_UNESCAPED_UNICODE)."\n```";
}

function newDeck(array $overrides = [])
{
    $t = test();

    return $t->actingAs($t->owner)->postJson('/api/presentations', [
        'project_id' => $t->project->id, 'brief' => 'Apresentação mensal para o dono da padaria, foco em vendas pelo Instagram.',
        'format' => 'slides', 'period_preset' => 'last_30', ...$overrides,
    ], $t->headers);
}

it('exige a IA configurada', function () {
    studioWriter([]);
    newDeck()->assertUnprocessable()->assertJsonValidationErrors(['ai' => 'Configurações › IA']);
});

it('gera a apresentação só com as métricas do projeto e números calculados pelo Delta', function () {
    studioAi();
    $writer = studioWriter([deck()]);

    $deck = newDeck()->assertAccepted()->json('data');
    expect($deck['status'])->toBe('ready')->and($deck['current_version'])->toBe(1);

    $rendered = $deck['version']['rendered'];
    $slides = collect($rendered['sections']);
    expect($slides->pluck('title')->all())->toBe(['Resumo executivo', 'Evolução das conversões', 'Próximos passos']) // sem o slide só com métrica de canal não conectado
        ->and(collect($slides[0]['blocks'])->pluck('type')->all())->toBe(['text', 'kpis'])
        ->and(collect($slides[0]['blocks'][1]['metrics'])->pluck('key')->all())->toBe(['meta_ads:spend', 'meta_ads:cpa']) // google_ads fora
        ->and($slides[0]['blocks'][1]['metrics'][0]['value'])->toBeGreaterThan(0)
        ->and(collect($slides[1]['blocks'][1]['metrics'])->pluck('key')->all())->toBe(['meta_ads:ctr', 'meta_ads:cpm'])
        ->and($deck['version']['unverified_numbers'])->toBe([]);

    $prompt = $writer->calls[0]['messages'][0]['content'];
    expect($prompt)->toContain('meta_ads:cpa')->not->toContain('google_ads:cost')->toContain('FATOS')
        ->and($writer->calls[0]['system'])->toContain('APENAS com um JSON');
    expect(asTenant($this->tenant, fn () => DB::table('ai_usage')->where('feature', 'studio_generate')->count()))->toBe(1);
});

it('pede correção quando a IA escreve um número que não está nos fatos', function () {
    studioAi();
    $bad = deck(['slides' => [['title' => 'Resumo', 'text' => 'O ROAS chegou a 9,87 no período.', 'metrics' => ['meta_ads:roas'], 'chart' => null, 'table' => []]]]);
    $fixed = deck(['slides' => [['title' => 'Resumo', 'text' => 'O ROAS ficou estável no período.', 'metrics' => ['meta_ads:roas'], 'chart' => null, 'table' => []]]]);
    $writer = studioWriter([$bad, $fixed]);

    $deck = newDeck()->json('data');

    expect($writer->calls)->toHaveCount(2)
        ->and(end($writer->calls[1]['messages'])['content'])->toContain('9,87')
        ->and($deck['version']['unverified_numbers'])->toBe([])
        ->and($deck['versions'][0]['verified'])->toBeTrue();
});

it('tenta de novo quando a IA não devolve JSON, e registra a falha se insistir', function () {
    studioAi();
    studioWriter(['Claro! Aqui está sua apresentação incrível.', deck()]);
    expect(newDeck()->json('data.status'))->toBe('ready');

    studioWriter(['sem json', 'ainda sem json']);
    $failed = newDeck()->json('data');
    expect($failed['status'])->toBe('error')->and($failed['error'])->toContain('não conseguiu montar');

    studioWriter([deck()]);
    $this->actingAs($this->owner)->postJson("/api/presentations/{$failed['id']}/retry", [], $this->headers)->assertAccepted()->assertJsonPath('data.status', 'ready');
});

it('ajusta por chat criando versões, e volta para uma anterior', function () {
    studioAi();
    $writer = studioWriter([deck(), deck(['title' => 'Resultados de outubro (curto)', 'slides' => [['title' => 'Resumo', 'text' => 'Versão enxuta.', 'metrics' => ['meta_ads:spend'], 'chart' => null, 'table' => []]]])]);
    $deck = newDeck()->json('data');

    $revised = $this->actingAs($this->owner)->postJson("/api/presentations/{$deck['id']}/revise", ['instruction' => 'Deixe só um slide de resumo'], $this->headers)->assertAccepted()->json('data');
    expect($revised['current_version'])->toBe(2)->and(collect($revised['version']['rendered']['sections'])->pluck('title')->all())->toBe(['Resumo'])
        ->and($revised['versions'])->toHaveCount(2)->and($revised['versions'][1]['instruction'])->toBe('Deixe só um slide de resumo');

    $messages = $writer->calls[1]['messages'];
    expect($messages[1]['role'])->toBe('assistant')->and($messages[1]['content'])->toContain('Resultados de outubro')
        ->and($messages[2]['content'])->toContain('AJUSTE PEDIDO PELA EQUIPE: Deixe só um slide de resumo');

    $this->actingAs($this->owner)->postJson("/api/presentations/{$deck['id']}/restore", ['number' => 1], $this->headers)->assertOk()->assertJsonPath('data.version.number', 1);
    $this->actingAs($this->owner)->getJson("/api/presentations/{$deck['id']}/versions/2", $this->headers)->assertOk()->assertJsonPath('data.version.number', 2);
});

it('exporta PDF em paisagem 16:9 com a marca da agência', function () {
    studioAi();
    studioWriter([deck()]);
    Http::fake(['gotenberg:3000/*' => Http::response('%PDF-1.7 apresentação', 200)]);
    $deck = newDeck()->json('data');

    $response = $this->actingAs($this->owner)->get("/api/presentations/{$deck['id']}/pdf", $this->headers)->assertOk();
    expect($response->headers->get('Content-Type'))->toBe('application/pdf')
        ->and($response->headers->get('Content-Disposition'))->toContain('.pdf');
    Http::assertSent(fn (Request $r) => str_contains($r->url(), '/forms/chromium/convert/html')
        && collect($r->data())->contains(fn ($part) => ($part['name'] ?? null) === 'paperWidth' && ($part['contents'] ?? null) === '11.69')
        && collect($r->data())->contains(fn ($part) => ($part['name'] ?? null) === 'files' && str_contains((string) ($part['contents'] ?? ''), 'page-break-before: always')));
});

it('só a equipe da agência acessa', function () {
    studioAi();
    studioWriter([deck()]);
    $deck = newDeck()->json('data');

    $client = addUserToTenant($this->tenant, TenantRole::Client);
    $this->actingAs($client)->getJson('/api/presentations', $this->headers)->assertForbidden();

    [$other, $otherOwner] = tenantWithOwner('Agência Boreal');
    $this->actingAs($otherOwner)->getJson("/api/presentations/{$deck['id']}", ['X-Tenant-Id' => $other->id])->assertNotFound();
});
