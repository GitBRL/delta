import { loadConfig, resolveProfile, saveConfig } from './config.mjs';
import { formatChange, formatValue, render } from './format.mjs';
import { McpClient, McpError } from './mcp.mjs';

export const VERSION = '0.1.0';

const HELP = `delta ${VERSION} — o Delta no terminal (via servidor MCP)

Conta
  delta login --url <api> --token <dlt_…|->   salva o acesso (use "-" para ler o token da entrada)
  delta logout                                  apaga o perfil
  delta status                                  perfil, servidor e ferramentas liberadas

Dados
  delta projects                                projetos (clientes) da agência
  delta project <projeto>                       dados de negócio e contas conectadas
  delta metrics catalog [--provider X] [--search Y]
  delta metrics get <projeto> <métrica…> [--period last_30|last_7|last_14|last_month|this_month|custom]
                    [--start AAAA-MM-DD --end AAAA-MM-DD] [--compare previous_period|previous_year|none] [--series]
  delta summary <projeto>                       saúde da conta e sinais de atenção
  delta goals [<projeto>]                       metas e progresso
  delta timeline <projeto> [--start --end]      linha do tempo
  delta reports [<projeto>]                     relatórios e versões publicadas
  delta snapshot <id>                           conteúdo de uma versão publicada (JSON)

Avançado
  delta shell                                   modo interativo (vários comandos sem repetir "delta"; "sair" encerra)
  delta tools                                   ferramentas do servidor
  delta call <ferramenta> [chave=valor …]       chama uma ferramenta direto
  delta prompts | delta prompt <nome> [chave=valor …]

Opções gerais: --json, --csv, --profile <nome>
<projeto> aceita o id ou parte do nome. DELTA_URL e DELTA_TOKEN substituem o perfil salvo.
`;

/** Argumentos: posicionais, --flag valor, --flag=valor e flags booleanas. */
export function parseArgs(argv) {
  const BOOLEAN = new Set(['json', 'csv', 'series', 'help', 'version']);
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h') flags.help = true;
    else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split(/=(.*)/s, 2);
      if (inline !== undefined) flags[key] = inline;
      else if (BOOLEAN.has(key)) flags[key] = true;
      else flags[key] = argv[++i];
    } else positional.push(arg);
  }
  return { positional, flags };
}

/** Divide uma linha como o shell: espaços separam, aspas simples ou duplas agrupam. */
export function splitLine(line) {
  const out = [];
  let current = '';
  let quote = null;
  let started = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || current) out.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (quote) throw new McpError('Aspas sem fechar.');
  if (started || current) out.push(current);
  return out;
}

/** Modo interativo: lê comandos da entrada até "sair" (ou fim da entrada). */
async function shell(io) {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: io.stdin, output: io.stdout, terminal: Boolean(io.stdin?.isTTY), prompt: 'delta> ' });
  let closed = false;
  rl.on('close', () => { closed = true; });
  const prompt = () => { if (!closed) rl.prompt(); };
  io.stdout.write('Modo interativo do Delta. Digite "help" para os comandos e "sair" para encerrar.\n');
  prompt();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === 'sair' || trimmed === 'exit' || trimmed === 'quit') break;
    if (trimmed !== '') {
      try {
        const argv = splitLine(trimmed);
        if (argv[0] === 'delta') argv.shift();
        if (argv[0] === 'shell') io.stdout.write('Você já está no modo interativo.\n');
        else await main(argv, io);
      } catch (error) {
        io.stderr.write(`Erro: ${error.message}\n`);
      }
    }
    prompt();
  }
  rl.close();
  return 0;
}

/** "chave=valor" → objeto; o valor vira JSON quando for JSON válido (números, listas, booleanos). */
export function keyValues(items) {
  const out = {};
  for (const item of items) {
    const at = item.indexOf('=');
    if (at < 1) throw new McpError(`Use chave=valor (recebi "${item}").`);
    const raw = item.slice(at + 1);
    try {
      out[item.slice(0, at)] = JSON.parse(raw);
    } catch {
      out[item.slice(0, at)] = raw;
    }
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id do projeto a partir do id ou de parte do nome (sem diferenciar acentos e maiúsculas). */
async function projectId(client, ref) {
  if (!ref) throw new McpError('Informe o projeto (id ou parte do nome).');
  if (UUID.test(ref)) return ref;
  const normalize = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const matches = (await client.callTool('list_projects')).filter((p) => normalize(p.name).includes(normalize(ref)));
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) throw new McpError(`Nenhum projeto com "${ref}" no nome. Veja "delta projects".`);
  throw new McpError(`Mais de um projeto com "${ref}": ${matches.map((p) => p.name).join(', ')}. Seja mais específico ou use o id.`);
}

async function readStdin(stdin) {
  let data = '';
  for await (const chunk of stdin) data += chunk;
  return data.trim();
}

export async function main(argv, io) {
  const { stdout, stderr, env } = io;
  const out = (text) => stdout.write(text);
  const { positional, flags } = parseArgs(argv);
  const [command, ...rest] = positional;

  if (flags.version) {
    out(`${VERSION}\n`);
    return 0;
  }
  if (!command || flags.help || command === 'help') {
    out(HELP);
    return 0;
  }
  if (command === 'shell') {
    return shell(io);
  }

  try {
    const config = await loadConfig(env);
    const profile = resolveProfile(config, env, flags.profile);
    const connect = async (url = profile.url, token = profile.token) => {
      const client = new McpClient({ url, token, fetchImpl: io.fetch, clientVersion: VERSION });
      await client.connect();
      return client;
    };

    switch (command) {
      case 'login': {
        const url = flags.url ?? profile.url;
        let token = flags.token ?? env.DELTA_TOKEN;
        if (token === '-') token = await readStdin(io.stdin);
        if (!url || !token) throw new McpError('Use: delta login --url https://api.seu-dominio.com --token dlt_…  (ou --token - para ler da entrada)');
        const client = await connect(url, token);
        const tools = await client.listTools();
        config.profiles[profile.name] = { url, token };
        config.current = profile.name;
        await saveConfig(env, config);
        out(`Conectado a ${client.url} (perfil "${profile.name}"). ${tools.length} ferramenta(s) liberada(s) para este token.\n`);
        return 0;
      }
      case 'logout': {
        delete config.profiles[profile.name];
        await saveConfig(env, config);
        out(`Perfil "${profile.name}" removido.\n`);
        return 0;
      }
      case 'status': {
        const client = await connect();
        const tools = await client.listTools();
        const data = { profile: profile.name, url: client.url, token: `${String(profile.token).slice(0, 10)}…`, tools: tools.map((t) => t.name) };
        out(flags.json ? `${JSON.stringify(data, null, 2)}\n` : `Perfil: ${data.profile}\nServidor: ${data.url}\nToken: ${data.token}\nFerramentas: ${data.tools.join(', ') || 'nenhuma (o token não tem escopos de leitura)'}\n`);
        return 0;
      }
      case 'projects': {
        const projects = await (await connect()).callTool('list_projects');
        out(render(flags, projects, projects, [
          { label: 'ID', key: 'id', value: (p) => p.id },
          { label: 'Projeto', key: 'name', value: (p) => p.name },
          { label: 'Nicho', key: 'niche', value: (p) => p.niche ?? '' },
        ]));
        return 0;
      }
      case 'project': {
        const client = await connect();
        const data = await client.callTool('get_project', { project_id: await projectId(client, rest[0]) });
        if (flags.json || flags.csv) {
          out(`${JSON.stringify(data, null, 2)}\n`);
          return 0;
        }
        const p = data.project ?? {};
        out(`${p.name}\nNicho: ${p.niche ?? '—'}\n\nContas conectadas:\n`);
        out(render({}, data.accounts, data.accounts ?? [], [
          { label: 'Canal', value: (a) => a.provider },
          { label: 'Conta', value: (a) => a.name },
          { label: 'Moeda', value: (a) => a.currency ?? '' },
        ]));
        return 0;
      }
      case 'metrics': {
        const client = await connect();
        if (rest[0] === 'catalog') {
          const metrics = await client.callTool('list_metrics', { ...(flags.provider ? { provider: flags.provider } : {}), ...(flags.search ? { search: flags.search } : {}) });
          out(render(flags, metrics, metrics, [
            { label: 'Chave', key: 'key', value: (m) => m.key },
            { label: 'Métrica', key: 'label', value: (m) => m.label },
            { label: 'Unidade', key: 'unit', value: (m) => m.unit },
          ]));
          return 0;
        }
        if (rest[0] !== 'get') throw new McpError('Use "delta metrics catalog" ou "delta metrics get <projeto> <métrica…>".');
        const [, ref, ...keys] = rest;
        if (keys.length === 0) throw new McpError('Informe ao menos uma métrica, ex.: meta_ads:spend meta_ads:cpa (veja "delta metrics catalog").');
        const data = await client.callTool('get_metrics_data', {
          project_id: await projectId(client, ref),
          metrics: keys,
          ...(flags.period ? { period: flags.period } : {}),
          ...(flags.start ? { start: flags.start, period: flags.period ?? 'custom' } : {}),
          ...(flags.end ? { end: flags.end } : {}),
          ...(flags.compare ? { compare: flags.compare } : {}),
          ...(flags.series ? { series: true } : {}),
        });
        const rows = data.metrics ?? [];
        out(render(flags, data, rows, [
          { label: 'Métrica', key: 'key', value: (m) => m.label ?? m.key, raw: (m) => m.key },
          { label: 'Valor', key: 'value', align: 'right', value: (m) => formatValue(m.value, m.unit), raw: (m) => m.value },
          { label: 'Anterior', key: 'previous', align: 'right', value: (m) => formatValue(m.previous, m.unit), raw: (m) => m.previous },
          { label: 'Variação', key: 'change_pct', align: 'right', value: (m) => formatChange(m.change_pct), raw: (m) => m.change_pct },
        ]));
        return 0;
      }
      case 'summary': {
        const client = await connect();
        const data = await client.callTool('get_performance_summary', { project_id: await projectId(client, rest[0]) });
        if (flags.json || flags.csv) {
          out(`${JSON.stringify(data, null, 2)}\n`);
          return 0;
        }
        const level = { good: 'boa', fair: 'regular', poor: 'precisa de atenção' }[data.health?.level] ?? data.health?.level;
        out(`Saúde da conta: ${data.health?.score ?? '—'}/100 (${level})\n`);
        for (const f of data.health?.factors ?? []) out(`  ${f.impact} ${f.label}\n`);
        out(`\nSinais de ${data.period?.start} a ${data.period?.end}:\n`);
        if ((data.signals ?? []).length === 0) out('  Nenhum sinal de atenção.\n');
        const icon = { critical: '●', attention: '▲', opportunity: '◆' };
        for (const s of data.signals ?? []) out(`  ${icon[s.status] ?? '·'} ${s.title}\n    ${s.explanation}\n    → ${s.suggestion}\n`);
        return 0;
      }
      case 'goals': {
        const client = await connect();
        const goals = await client.callTool('list_goals', rest[0] ? { project_id: await projectId(client, rest[0]) } : {});
        const status = { on_track: 'no ritmo', at_risk: 'em risco', off_track: 'fora do ritmo', achieved: 'atingida', no_data: 'sem dados' };
        out(render(flags, goals, goals, [
          { label: 'Projeto', value: (g) => g.project?.name },
          { label: 'Meta', value: (g) => g.progress?.label ?? g.metric_key },
          { label: 'Alvo', align: 'right', value: (g) => formatValue(g.target, g.progress?.unit), raw: (g) => g.target },
          { label: 'Atual', align: 'right', value: (g) => formatValue(g.progress?.value, g.progress?.unit), raw: (g) => g.progress?.value },
          { label: 'Projeção', align: 'right', value: (g) => formatValue(g.progress?.projection, g.progress?.unit), raw: (g) => g.progress?.projection },
          { label: 'Situação', value: (g) => status[g.progress?.status] ?? g.progress?.status, raw: (g) => g.progress?.status },
        ]));
        return 0;
      }
      case 'timeline': {
        const client = await connect();
        const events = await client.callTool('list_timeline_events', {
          project_id: await projectId(client, rest[0]),
          ...(flags.start ? { start: flags.start } : {}),
          ...(flags.end ? { end: flags.end } : {}),
        });
        out(render(flags, events, events, [
          { label: 'Data', value: (e) => e.occurred_on },
          { label: 'Marco', value: (e) => e.title },
          { label: 'Tipo', value: (e) => (e.manual ? 'manual' : e.type) },
        ]));
        return 0;
      }
      case 'reports': {
        const client = await connect();
        const data = await client.callTool('list_reports', rest[0] ? { project_id: await projectId(client, rest[0]) } : {});
        out(render(flags, data, data.reports ?? [], [
          { label: 'ID', value: (r) => r.id },
          { label: 'Relatório', value: (r) => r.title },
          { label: 'Projeto', value: (r) => r.project?.name ?? '' },
          { label: 'Última publicação', value: (r) => r.last_published_at?.slice(0, 10) ?? '—' },
          { label: 'Versões', align: 'right', value: (r) => r.versions ?? 0 },
        ]));
        if (!flags.json && (data.snapshots ?? []).length > 0) {
          out('\nVersões publicadas (delta snapshot <id>):\n');
          out(render(flags, data.snapshots, data.snapshots, [
            { label: 'ID', value: (s) => s.id },
            { label: 'Publicada em', value: (s) => s.created_at?.slice(0, 16).replace('T', ' ') },
            { label: 'Título', value: (s) => s.title ?? '' },
          ]));
        }
        return 0;
      }
      case 'snapshot': {
        if (!rest[0]) throw new McpError('Informe o id da versão publicada (veja "delta reports <projeto>").');
        out(`${JSON.stringify(await (await connect()).callTool('get_report_snapshot', { snapshot_id: rest[0] }), null, 2)}\n`);
        return 0;
      }
      case 'tools': {
        const tools = await (await connect()).listTools();
        out(render(flags, tools, tools, [
          { label: 'Ferramenta', key: 'name', value: (t) => t.name },
          { label: 'Descrição', key: 'description', value: (t) => (t.description ?? '').split('. ')[0] },
        ]));
        return 0;
      }
      case 'call': {
        if (!rest[0]) throw new McpError('Use: delta call <ferramenta> [chave=valor …]');
        const result = await (await connect()).callTool(rest[0], keyValues(rest.slice(1)));
        out(typeof result === 'string' ? `${result}\n` : `${JSON.stringify(result, null, 2)}\n`);
        return 0;
      }
      case 'prompts': {
        const prompts = await (await connect()).listPrompts();
        out(render(flags, prompts, prompts, [
          { label: 'Prompt', value: (p) => p.name },
          { label: 'Descrição', value: (p) => p.description ?? '' },
        ]));
        return 0;
      }
      case 'prompt': {
        if (!rest[0]) throw new McpError('Use: delta prompt <nome> [chave=valor …] (veja "delta prompts").');
        const result = await (await connect()).getPrompt(rest[0], keyValues(rest.slice(1)));
        out(`${(result?.messages ?? []).map((m) => m.content?.text ?? '').join('\n\n').trim()}\n`);
        return 0;
      }
      default:
        stderr.write(`Comando desconhecido: ${command}\n\n${HELP}`);
        return 2;
    }
  } catch (error) {
    stderr.write(`Erro: ${error instanceof McpError ? error.message : error?.message ?? String(error)}\n`);
    return 1;
  }
}
