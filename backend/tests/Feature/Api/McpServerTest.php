<?php

declare(strict_types=1);

use App\Models\Project;

/*
| Servidor MCP (ADR 0026): chamado por HTTP como um assistente de IA faria (initialize,
| tools/list, tools/call), com o token da API pública e os escopos dele.
*/

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora', 'niche' => 'ecommerce']));
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$meta->accounts->firstOrFail()->id]], $this->headers)->assertOk();
});

function mcpToken(array $scopes): string
{
    $t = test();

    return (string) $t->actingAs($t->owner)->postJson('/api/api-tokens', ['name' => 'Claude', 'scopes' => $scopes], $t->headers)->assertCreated()->json('token');
}

/** Mensagem JSON-RPC para /mcp, sem sessão de navegador (como um cliente MCP). */
function mcp(string $token, string $method, array $params = [])
{
    auth()->forgetGuards();
    security()->clear();

    return test()->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => $method, 'params' => (object) $params], [
        'Authorization' => "Bearer {$token}", 'Accept' => 'application/json, text/event-stream',
    ]);
}

/** Resultado de uma ferramenta, já decodificado do texto JSON. */
function callTool(string $token, string $name, array $arguments = []): array
{
    $result = mcp($token, 'tools/call', ['name' => $name, 'arguments' => (object) $arguments])->assertOk()->json('result');

    return ['error' => $result['isError'] ?? false, 'text' => $result['content'][0]['text'] ?? '', 'json' => json_decode($result['content'][0]['text'] ?? 'null', true)];
}

it('apresenta o servidor e lista só as ferramentas liberadas pelos escopos do token', function () {
    $token = mcpToken(['mcp:tools', 'projects:read', 'metrics:read']);

    mcp($token, 'initialize', ['protocolVersion' => '2025-06-18', 'capabilities' => (object) [], 'clientInfo' => ['name' => 'teste', 'version' => '1']])
        ->assertOk()->assertJsonPath('result.serverInfo.name', 'Delta');

    $tools = collect(mcp($token, 'tools/list')->assertOk()->json('result.tools'))->pluck('name')->all();
    expect($tools)->toContain('list_projects', 'get_metrics_data', 'get_performance_summary', 'list_goals')
        ->not->toContain('list_reports', 'get_report_snapshot');

    $prompts = collect(mcp($token, 'prompts/list')->assertOk()->json('result.prompts'))->pluck('name')->all();
    expect($prompts)->toContain('monthly-review', 'campaign-analysis');
});

it('exige token válido com o escopo mcp:tools', function () {
    $this->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list'])->assertUnauthorized();
    mcp(mcpToken(['projects:read']), 'tools/list')->assertForbidden();
});

it('responde com os dados da agência do token, sob RLS', function () {
    $token = mcpToken(['mcp:tools', 'projects:read', 'metrics:read']);
    [$other] = tenantWithOwner('Agência Boreal');
    asTenant($other, fn () => Project::query()->create(['name' => 'Projeto de outra agência']));

    $projects = callTool($token, 'list_projects');
    expect(collect($projects['json'])->pluck('name')->all())->toBe(['Padaria Aurora']);

    $data = callTool($token, 'get_metrics_data', ['project_id' => $this->project->id, 'metrics' => ['meta_ads:spend', 'meta_ads:cpa'], 'period' => 'last_30']);
    $values = collect($data['json']['metrics'])->keyBy('key');
    expect($data['error'])->toBeFalse()
        ->and($values['meta_ads:spend']['value'])->toBeGreaterThan(0)
        ->and($values['meta_ads:cpa'])->toHaveKey('change_pct');

    $summary = callTool($token, 'get_performance_summary', ['project_id' => $this->project->id]);
    expect($summary['json'])->toHaveKeys(['health', 'signals', 'period'])->and($summary['json']['health'])->toHaveKey('score');

    $catalog = callTool($token, 'list_metrics', ['provider' => 'meta_ads', 'search' => 'cpa']);
    expect(collect($catalog['json'])->pluck('key')->all())->toContain('meta_ads:cpa')->each->toStartWith('meta_ads:');
});

it('explica erros sem vazar nada (projeto inexistente ou de outra agência, métrica faltando)', function () {
    $token = mcpToken(['mcp:tools', 'projects:read', 'metrics:read']);
    [$other] = tenantWithOwner('Agência Boreal');
    $foreign = asTenant($other, fn () => Project::query()->create(['name' => 'Secreto']));

    $result = callTool($token, 'get_project', ['project_id' => $foreign->id]);
    expect($result['error'])->toBeTrue()->and($result['text'])->toContain('Projeto não encontrado')->not->toContain('Secreto');

    $result = callTool($token, 'get_metrics_data', ['project_id' => $this->project->id, 'metrics' => []]);
    expect($result['error'])->toBeTrue();
});

it('lê relatórios publicados com o escopo reports:read', function () {
    $token = mcpToken(['mcp:tools', 'reports:read']);
    $report = $this->actingAs($this->owner)->postJson('/api/reports', ['project_id' => $this->project->id, 'title' => 'Mensal', 'template' => 'ecommerce'], $this->headers)->assertCreated()->json('data.id');
    $snapshot = $this->actingAs($this->owner)->postJson("/api/reports/{$report}/snapshots", [], $this->headers)->assertCreated()->json('data.id');

    $list = callTool($token, 'list_reports', ['project_id' => $this->project->id]);
    expect($list['json']['reports'][0]['title'])->toBe('Mensal')->and($list['json']['snapshots'][0]['id'])->toBe($snapshot);

    $content = callTool($token, 'get_report_snapshot', ['snapshot_id' => $snapshot]);
    expect($content['error'])->toBeFalse()->and($content['json'])->toHaveKey('data');

    $prompt = mcp($token, 'prompts/get', ['name' => 'monthly-review', 'arguments' => ['project' => 'Padaria Aurora']])->assertOk();
    expect($prompt->json('result.messages.0.content.text'))->toContain('Padaria Aurora')->toContain('get_metrics_data');
});
