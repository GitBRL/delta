import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Readable } from 'node:stream';
import { main, parseArgs, keyValues, splitLine } from '../src/main.mjs';
import { formatValue, formatChange } from '../src/format.mjs';

const TOKEN = 'dlt_' + 'a'.repeat(40);
const PROJECT = { id: '0193a8f2-1111-7000-8000-000000000001', name: 'Padaria Aurora', niche: 'ecommerce' };
const calls = [];

/** Servidor MCP falso: confere token e responde como o Delta (JSON ou SSE). */
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const message = JSON.parse(body);
  calls.push({ method: message.method, params: message.params, headers: req.headers });

  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401).end();
    return;
  }
  if (!('id' in message)) {
    res.writeHead(202).end();
    return;
  }

  const reply = (result) => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: message.id, result });
    if (message.method === 'tools/list') {
      res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`event: message\ndata: ${payload}\n\n`);
    } else {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sessao-1' }).end(payload);
    }
  };
  const text = (data, isError = false) => reply({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }], isError });

  switch (message.method) {
    case 'initialize':
      return reply({ protocolVersion: '2025-06-18', serverInfo: { name: 'Delta', version: '1.0.0' }, capabilities: { tools: {} } });
    case 'tools/list':
      return reply({ tools: [{ name: 'list_projects', description: 'Lista os projetos. Use o id.' }, { name: 'get_metrics_data', description: 'Valores.' }] });
    case 'tools/call': {
      const { name, arguments: args } = message.params;
      if (name === 'list_projects') return text([PROJECT, { id: '0193a8f2-1111-7000-8000-000000000002', name: 'Curso Alfa', niche: 'infoproduto' }]);
      if (name === 'get_metrics_data') {
        if (args.project_id !== PROJECT.id) return text('Projeto não encontrado.', true);
        return text({ metrics: [
          { key: 'meta_ads:spend', label: 'Investimento', unit: 'currency', value: 1234.5, previous: 1000, change_pct: 23.45 },
          { key: 'meta_ads:ctr', label: 'CTR (link)', unit: 'percent', value: 1.27, previous: null, change_pct: null },
        ] });
      }
      if (name === 'get_performance_summary') {
        return text({ health: { score: 72, level: 'fair', factors: [{ label: '1 ponto(s) de atenção', impact: -8 }] }, period: { start: '2026-11-05', end: '2026-11-11' },
          signals: [{ status: 'attention', title: 'Público saturando', explanation: 'Frequência de 3,4.', suggestion: 'Renove os criativos.' }] });
      }
      return text('Ferramenta desconhecida.', true);
    }
    default:
      return reply({});
  }
});

let url;
let configDir;
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  configDir = await mkdtemp(join(tmpdir(), 'delta-cli-'));
});
after(() => server.close());

async function run(argv, env = {}) {
  let stdout = '';
  let stderr = '';
  const code = await main(argv, {
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
    env: { DELTA_CONFIG_DIR: configDir, ...env },
  });
  return { code, stdout, stderr };
}

test('lê argumentos, flags e chave=valor', () => {
  assert.deepEqual(parseArgs(['metrics', 'get', 'x', '--period', 'last_7', '--json', '--start=2026-01-01']), {
    positional: ['metrics', 'get', 'x'], flags: { period: 'last_7', json: true, start: '2026-01-01' },
  });
  assert.deepEqual(keyValues(['project_id=abc', 'metrics=["a:b"]', 'series=true']), { project_id: 'abc', metrics: ['a:b'], series: true });
});

test('formata no padrão brasileiro', () => {
  assert.equal(formatValue(1234.5, 'currency').replace(/\s/g, ' '), 'R$ 1.234,50');
  assert.equal(formatValue(1.27, 'percent'), '1,27%');
  assert.equal(formatChange(23.45), '+23,45%');
  assert.equal(formatValue(null, 'count'), '—');
});

test('login confere o acesso e salva o perfil só para o usuário (600)', async () => {
  const { code, stdout } = await run(['login', '--url', url, '--token', TOKEN]);
  assert.equal(code, 0);
  assert.match(stdout, /Conectado a .*\/mcp .*2 ferramenta/);
  const file = join(configDir, 'config.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).profiles.default.token, TOKEN);

  const init = calls.find((c) => c.method === 'initialize');
  assert.equal(init.params.clientInfo.name, 'delta-cli');
  assert.ok(calls.some((c) => c.method === 'notifications/initialized'));
});

test('lista projetos em tabela, JSON e CSV', async () => {
  const table = await run(['projects']);
  assert.match(table.stdout, /Projeto\s+Nicho/);
  assert.match(table.stdout, /Padaria Aurora\s+ecommerce/);
  assert.equal(JSON.parse((await run(['projects', '--json'])).stdout)[1].name, 'Curso Alfa');
  assert.match((await run(['projects', '--csv'])).stdout, /^id;name;niche\n0193a8f2-1111-7000-8000-000000000001;Padaria Aurora;ecommerce/);
});

test('acha o projeto por parte do nome (sem acento) e mostra métricas com variação', async () => {
  calls.length = 0;
  const { code, stdout } = await run(['metrics', 'get', 'padaria', 'meta_ads:spend', 'meta_ads:ctr', '--period', 'last_7']);
  assert.equal(code, 0);
  assert.match(stdout, /Investimento\s+R\$\s1\.234,50\s+R\$\s1\.000,00\s+\+23,45%/);
  assert.match(stdout, /CTR \(link\)\s+1,27%\s+—\s+—/);
  const call = calls.find((c) => c.params?.name === 'get_metrics_data');
  assert.deepEqual(call.params.arguments, { project_id: PROJECT.id, metrics: ['meta_ads:spend', 'meta_ads:ctr'], period: 'last_7' });
  assert.equal(call.headers['mcp-session-id'], 'sessao-1');
  assert.equal(call.headers['mcp-protocol-version'], '2025-06-18');
});

test('resume saúde e sinais em português', async () => {
  const { stdout } = await run(['summary', PROJECT.id]);
  assert.match(stdout, /Saúde da conta: 72\/100 \(regular\)/);
  assert.match(stdout, /▲ Público saturando\n\s+Frequência de 3,4\.\n\s+→ Renove os criativos\./);
});

test('explica erros: projeto ambíguo, ferramenta com erro, token recusado', async () => {
  const ambiguous = await run(['metrics', 'get', 'a', 'meta_ads:spend']);
  assert.equal(ambiguous.code, 1);
  assert.match(ambiguous.stderr, /Mais de um projeto com "a"/);

  const missing = await run(['call', 'get_metrics_data', 'project_id=outro', 'metrics=["x:y"]']);
  assert.match(missing.stderr, /Projeto não encontrado/);

  const denied = await run(['projects'], { DELTA_TOKEN: 'dlt_' + 'b'.repeat(40) });
  assert.equal(denied.code, 1);
  assert.match(denied.stderr, /Token inválido, expirado ou revogado/);
});

test('ajuda e comando desconhecido', async () => {
  assert.match((await run([])).stdout, /delta login --url/);
  const unknown = await run(['voar']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Comando desconhecido: voar/);
});

test('divide linhas com aspas como o shell', () => {
  assert.deepEqual(splitLine('metrics get "Padaria Aurora" meta_ads:spend --period=last_7'), ['metrics', 'get', 'Padaria Aurora', 'meta_ads:spend', '--period=last_7']);
  assert.deepEqual(splitLine("call get_project project_id='abc def'"), ['call', 'get_project', 'project_id=abc def']);
  assert.throws(() => splitLine('projects "sem fim'), /Aspas sem fechar/);
});

test('modo interativo roda vários comandos e encerra com "sair"', async () => {
  let stdout = '';
  let stderr = '';
  const code = await main(['shell'], {
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
    stdin: Readable.from(['projects\n', 'delta metrics get "padaria" meta_ads:spend\n', 'comando-que-nao-existe\n', 'sair\n', 'projects\n']),
    env: { DELTA_CONFIG_DIR: configDir, DELTA_URL: url, DELTA_TOKEN: TOKEN },
  });
  assert.equal(code, 0);
  assert.match(stdout, /Modo interativo do Delta/);
  assert.equal((stdout.match(/Padaria Aurora\s+ecommerce/g) ?? []).length, 1); // depois de "sair" nada roda
  assert.match(stdout, /Investimento\s+R\$/);
  assert.match(stderr, /Comando desconhecido: comando-que-nao-existe/);
});
