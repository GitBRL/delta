<?php

declare(strict_types=1);

use App\Domain\Ai\AiReply;
use App\Domain\Ai\AiWriter;
use App\Domain\Ai\NumberGuard;
use App\Models\Project;
use App\Support\Tenancy\TenantRole;
use Illuminate\Support\Facades\DB;

/** Escritor falso: devolve as respostas na ordem e guarda o que recebeu. */
final class FakeWriter implements AiWriter
{
    /** @var list<array{key: string, system: string, messages: list<array{role: string, content: string}>}> */
    public array $calls = [];

    /** @param list<string|AiReply> $replies */
    public function __construct(public array $replies) {}

    public function generate(string $apiKey, string $system, array $messages): AiReply
    {
        $this->calls[] = ['key' => $apiKey, 'system' => $system, 'messages' => $messages];
        $next = array_shift($this->replies) ?? 'ok';

        return $next instanceof AiReply ? $next : new AiReply($next, 1200, 300);
    }
}

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora Ltda', 'niche' => 'restaurante_delivery']));
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$meta->accounts->firstOrFail()->id]], $this->headers)->assertOk();
    $this->report = $this->actingAs($this->owner)->postJson('/api/reports', ['project_id' => $this->project->id, 'title' => 'Mensal'], $this->headers)->json('data');
});

function useWriter(array $replies): FakeWriter
{
    $fake = new FakeWriter($replies);
    app()->instance(AiWriter::class, $fake);

    return $fake;
}

function configureAi(int $budget = 2_000_000): void
{
    $t = test();
    $t->actingAs($t->owner)->putJson('/api/ai', ['api_key' => 'sk-ant-api03-'.str_repeat('x', 30), 'enabled' => true, 'monthly_token_budget' => $budget], $t->headers)->assertOk();
}

it('exige a chave configurada pelo administrador e nunca a devolve', function () {
    useWriter([]);
    $this->actingAs($this->owner)->postJson("/api/reports/{$this->report['id']}/ai/analysis", [], $this->headers)
        ->assertUnprocessable()->assertJsonValidationErrors(['ai' => 'não está configurado']);

    $analyst = addUserToTenant($this->tenant, TenantRole::Analyst);
    security()->clear();
    $this->actingAs($analyst)->putJson('/api/ai', ['api_key' => 'sk-ant-'.str_repeat('y', 30), 'monthly_token_budget' => 100000], $this->headers)->assertForbidden();

    configureAi();
    $status = $this->actingAs($analyst)->getJson('/api/ai', $this->headers)->assertOk();
    expect($status->json('data'))->toMatchArray(['configured' => true, 'source' => 'agency'])
        ->and($status->getContent())->not->toContain('sk-ant');
});

it('escreve a análise só com os números dos fatos e sem dados pessoais', function () {
    configureAi();
    $first = useWriter(['Ótimo mês: o investimento ficou estável.']);
    $data = $this->actingAs($this->owner)->postJson("/api/reports/{$this->report['id']}/ai/analysis", ['period_preset' => 'last_30'], $this->headers)
        ->assertOk()->json('data');

    expect($data)->toMatchArray(['verified' => true, 'unverified_numbers' => [], 'suggestion' => true, 'model' => 'claude-opus-5-5'])
        ->and($first->calls)->toHaveCount(1)
        ->and($first->calls[0]['key'])->toStartWith('sk-ant-api03-');

    $prompt = $first->calls[0]['messages'][0]['content'];
    expect($prompt)->toContain('"nicho": "restaurante_delivery"')->toContain('Investimento')->toContain('R$ ')
        ->not->toContain('Padaria Aurora')->not->toContain($this->owner->email)
        ->and($first->calls[0]['system'])->toContain('SOMENTE números que aparecem nos FATOS');

    expect(security()->run($this->tenant->id, $this->owner->id, fn () => DB::table('ai_usage')->sum('output_tokens')))->toEqual(300);
});

it('pede correção quando a IA inventa um número e marca se persistir', function () {
    configureAi();
    $writer = useWriter(['O ROAS chegou a 7,77 e as vendas subiram 93,4%.', 'Ainda 93,4% de alta.']);

    $data = $this->actingAs($this->owner)->postJson("/api/reports/{$this->report['id']}/ai/analysis", [], $this->headers)->assertOk()->json('data');

    expect($writer->calls)->toHaveCount(2)
        ->and($writer->calls[1]['messages'][2]['content'])->toContain('7,77')->toContain('93,4')
        ->and($data['verified'])->toBeFalse()
        ->and($data['unverified_numbers'])->toBe(['93,4']);
});

it('respeita o orçamento mensal e trata a recusa do modelo', function () {
    configureAi(10000);
    useWriter([new AiReply('', 9000, 2000, refused: true)]);

    $this->actingAs($this->owner)->postJson("/api/projects/{$this->project->id}/ai/ask", ['question' => 'Como foi o mês?'], $this->headers)
        ->assertUnprocessable()->assertJsonPath('message', 'A IA não pôde gerar este texto. Tente reformular ou escreva manualmente.');

    $this->actingAs($this->owner)->postJson("/api/projects/{$this->project->id}/ai/ask", ['question' => 'E agora?'], $this->headers)
        ->assertUnprocessable()->assertJsonValidationErrors(['ai' => 'orçamento']);
});

it('confere números em formato brasileiro', function () {
    $facts = '{"valor": "R$ 11.057,13", "variacao": "▲ 2,8%", "alcance": "138,2 mil"}';

    expect(NumberGuard::unverified('Investimos R$ 11.057,13 (alta de 2,8%) e alcançamos 138,2 mil pessoas em 3 canais em 2026.', $facts))->toBe([])
        ->and(NumberGuard::unverified('Alcance de 140 mil e CPA de R$ 51,20.', $facts))->toBe(['140', '51,20']);
});
