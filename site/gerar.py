#!/usr/bin/env python3
"""
Gera o site de marketing do Delta (HTML estático, sem dependências).

Fonte única: este arquivo. Rode `make site-build` (ou `python3 site/gerar.py`) depois de editar.
APP_URL e SITE_URL ficam aqui porque o domínio ainda não foi decidido (a marca "Delta" é provisória).
"""
from __future__ import annotations

import html
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP_URL = os.environ.get('DELTA_APP_URL', 'http://localhost:4300')
SITE_URL = os.environ.get('DELTA_SITE_URL', 'http://localhost:4400')
SIGNUP = f'{APP_URL}/cadastro'

NAV = [
    ('/', 'Produto'),
    ('/precos.html', 'Preços'),
    ('/ferramentas/', 'Ferramentas'),
    ('/academy/', 'Academy'),
    ('/desenvolvedores.html', 'Desenvolvedores'),
]


def page(path: str, title: str, description: str, body: str, *, scripts: str = '', schema: dict | None = None) -> None:
    depth = path.count('/')
    canonical = SITE_URL + '/' + path.removesuffix('index.html')
    nav = '\n'.join(
        f'<li><a href="{href}"{" aria-current=\"page\"" if "/" + path.removesuffix("index.html") == href else ""}>{label}</a></li>'
        for href, label in NAV
    )
    ld = f'<script type="application/ld+json">{json.dumps(schema, ensure_ascii=False)}</script>' if schema else ''
    doc = f'''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(description)}">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(description)}">
<meta property="og:url" content="{canonical}">
<meta property="og:locale" content="pt_BR">
<meta name="theme-color" content="#0a84ff">
<link rel="icon" href="/assets/icone.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css">
{ld}
</head>
<body>
<a class="skip" href="#conteudo">Pular para o conteúdo</a>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/"><span aria-hidden="true">Δ</span>Delta</a>
    <nav class="main" aria-label="Principal"><ul>
{nav}
    </ul></nav>
    <a class="btn primary" href="{SIGNUP}">Testar grátis</a>
  </div>
</header>
<main id="conteudo">
{body}
</main>
<footer class="bottom">
  <div class="wrap cols">
    <div><strong>Delta</strong><p>Relatórios e inteligência de marketing para agências.</p></div>
    <div><strong>Produto</strong><ul>
      <li><a href="/">Visão geral</a></li><li><a href="/precos.html">Preços</a></li><li><a href="/seguranca.html">Segurança</a></li><li><a href="/desenvolvedores.html">API, MCP e Connect</a></li>
    </ul></div>
    <div><strong>Aprender</strong><ul>
      <li><a href="/academy/">Academy</a></li><li><a href="/glossario.html">Glossário</a></li><li><a href="/ferramentas/">Ferramentas gratuitas</a></li>
    </ul></div>
    <div><strong>Parcerias</strong><ul><li><a href="/afiliados.html">Programa de afiliados</a></li><li><a href="{APP_URL}/login">Entrar</a></li></ul></div>
  </div>
</footer>
{scripts}
</body>
</html>
'''
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(doc, encoding='utf-8')


def calc_page(slug: str, title: str, description: str, form: str, script: str, academy: str | None = None) -> None:
    more = f'<p class="note">Entenda a conta no artigo da <a href="/academy/{academy}">Academy</a>.</p>' if academy else ''
    page(f'ferramentas/{slug}', f'{title} · Ferramentas gratuitas do Delta', description, f'''
<article class="post">
  <p class="eyebrow">Ferramenta gratuita</p>
  <h1>{title}</h1>
  <p>{description}</p>
  {form}
  <div class="result" id="resultado" aria-live="polite"><p>Preencha os campos para ver o resultado.</p></div>
  {more}
  <p class="note">A conta é feita no seu navegador: nada do que você digita é enviado.</p>
</article>''', scripts=f'<script type="module">\n{script}\n</script>')


# ---------------------------------------------------------------- Páginas

page('index.html', 'Delta · Relatórios de marketing que já dizem o que fazer',
     'Relatórios automáticos para agências, enviados por e-mail e WhatsApp, com semáforo de atenção, metas, sugestões e IA que não inventa números.',
     f'''
<section class="hero"><div class="wrap">
  <p class="eyebrow">Para agências e times de marketing</p>
  <h1>Relatórios que já dizem<br>o que fazer em seguida.</h1>
  <p class="lead">Conecte as contas dos seus clientes, monte o relatório uma vez e o Delta envia por e-mail e WhatsApp, mostra o que precisa de atenção e sugere o próximo passo.</p>
  <div class="ctas"><a class="btn primary" href="{SIGNUP}">Testar grátis por 14 dias</a><a class="btn secondary" href="/precos.html">Ver planos</a></div>
  <p class="note">Sem cartão no teste. Funciona em modo demonstração antes de conectar as contas reais.</p>
</div></section>

<section class="band alt"><div class="wrap">
  <h2>Do dado ao "e agora?"</h2>
  <p class="sub">Relatório bonito é o começo. O Delta lê os números com as boas práticas de mídia e com o histórico de cada cliente.</p>
  <div class="grid">
    <div class="card"><span class="icon" aria-hidden="true">🚦</span><h3>Semáforo de atenção</h3><p>Regras de boas práticas, referências do nicho e o histórico do próprio cliente apontam o que piorou, com a explicação e uma sugestão.</p></div>
    <div class="card"><span class="icon" aria-hidden="true">🎯</span><h3>Metas e ritmo</h3><p>Metas por projeto com projeção para o fim do mês e alerta quando o ritmo cai.</p></div>
    <div class="card"><span class="icon" aria-hidden="true">✅</span><h3>Plano de ação medido</h3><p>Sugestões viram ações com responsável; depois de aplicadas, o Delta mede o resultado em 14 dias.</p></div>
    <div class="card"><span class="icon" aria-hidden="true">✨</span><h3>IA que não inventa número</h3><p>A análise escrita por IA só usa números que o Delta calculou, e um verificador confere cada um antes de mostrar.</p></div>
  </div>
</div></section>

<section class="band"><div class="wrap">
  <h2>Tudo o que a rotina da agência pede</h2>
  <div class="grid">
    <div class="card"><h3>Relatórios e dashboards</h3><p>Modelos por nicho, blocos de KPIs, gráficos e tabelas, link público, PDF e dashboard ao vivo.</p></div>
    <div class="card"><h3>Envio por WhatsApp e e-mail</h3><p>Envios automáticos com consentimento e descadastro em um clique, e caixa de respostas do WhatsApp.</p></div>
    <div class="card"><h3>Indicadores personalizados</h3><p>Fórmulas entre canais (ROAS combinado, CPA total) e fonte manual para vendas da loja física.</p></div>
    <div class="card"><h3>Publicações</h3><p>Calendário, mídia, aprovação do cliente por link e publicação agendada no Instagram e Facebook.</p></div>
    <div class="card"><h3>Studio</h3><p>Descreva a apresentação e a IA monta os slides com os dados do projeto. Ajuste por conversa e exporte em PDF.</p></div>
    <div class="card"><h3>Marca própria</h3><p>Sua cor, logo e domínio nos relatórios, no portal do cliente e nos e-mails.</p></div>
  </div>
</div></section>

<section class="band alt"><div class="wrap">
  <h2>Canais</h2>
  <p class="sub">Conexão em um clique, com o app da própria agência. Antes da aprovação das plataformas, use o modo demonstração.</p>
  <div class="chips">
    <span class="chip">Meta Ads</span><span class="chip">Google Ads</span><span class="chip">Google Analytics 4</span><span class="chip">Instagram</span><span class="chip">Facebook</span><span class="chip">Search Console</span><span class="chip">YouTube</span><span class="chip">Perfil da Empresa no Google</span><span class="chip">TikTok Ads</span><span class="chip">LinkedIn Ads</span><span class="chip">Google Sheets (exportação)</span>
  </div>
</div></section>

<section class="band"><div class="wrap">
  <h2>Para quem integra</h2>
  <p class="sub">API REST, webhooks assinados, servidor MCP para assistentes de IA, CLI e o Delta Connect para levar relatórios ao seu próprio SaaS.</p>
  <a class="btn secondary" href="/desenvolvedores.html">Conhecer a API</a>
</div></section>

<section class="band alt"><div class="wrap">
  <h2>Os dados de cada cliente, separados no próprio banco</h2>
  <p class="sub">Cada agência só enxerga os próprios dados, e a regra mora no banco de dados, não só no código. <a href="/seguranca.html">Veja como protegemos os dados</a>.</p>
  <a class="btn primary" href="{SIGNUP}">Começar agora</a>
</div></section>
''', schema={'@context': 'https://schema.org', '@type': 'SoftwareApplication', 'name': 'Delta', 'applicationCategory': 'BusinessApplication', 'operatingSystem': 'Web', 'inLanguage': 'pt-BR', 'description': 'Relatórios e inteligência de marketing para agências.'})

PLANS = [
    ('Essencial', ['5 projetos', '3 pessoas na equipe', '15 conexões reais', '300 mensagens de WhatsApp/mês', 'Publicações']),
    ('Pro', ['25 projetos', '10 pessoas na equipe', '75 conexões reais', '2.000 mensagens de WhatsApp/mês', 'Publicações e Studio', 'API, webhooks e MCP', 'Gestão de anúncios']),
    ('Agência', ['100 projetos', '30 pessoas na equipe', '300 conexões reais', '10.000 mensagens de WhatsApp/mês', 'Tudo do Pro', 'Marca própria com domínio']),
]
cards = '\n'.join(
    f'<div class="card"><h3>{name}</h3><p class="note">Sob consulta</p><ul class="check">{"".join(f"<li>{i}</li>" for i in items)}</ul></div>'
    for name, items in PLANS
)
page('precos.html', 'Preços e planos · Delta', 'Planos Essencial, Pro e Agência, com teste grátis de 14 dias com tudo liberado.', f'''
<section class="hero"><div class="wrap">
  <h1>Planos</h1>
  <p class="lead">Comece com 14 dias de teste com tudo liberado. Depois, escolha o plano do tamanho da sua carteira.</p>
</div></section>
<section class="band"><div class="wrap">
  <div class="grid">{cards}</div>
  <p class="note">Valores e limites em validação. Fale com a gente para uma proposta. Franquias de WhatsApp e IA podem ser ampliadas com pacotes adicionais.</p>
  <h2>Perguntas frequentes</h2>
  <h3>O que acontece quando o teste acaba?</h3><p>Nada é apagado. Você continua vendo tudo; criar projetos, conexões e envios novos depende de escolher um plano.</p>
  <h3>Preciso de cartão para testar?</h3><p>Não.</p>
  <h3>O WhatsApp tem custo à parte?</h3><p>Cada plano tem uma franquia de mensagens por mês. A Meta cobra por conversa de template; o Delta mede o consumo e avisa antes de acabar.</p>
  <h3>Posso usar o app da minha agência nas plataformas?</h3><p>Sim. O administrador cadastra o app da Meta, do Google, do TikTok e do LinkedIn pela tela, e o login das contas usa o app da agência.</p>
  <p><a class="btn primary" href="{SIGNUP}">Testar grátis</a></p>
</div></section>''')

page('seguranca.html', 'Segurança · Delta', 'Isolamento de dados no banco (RLS), tokens só como hash, credenciais criptografadas e passkeys.', '''
<article class="post">
  <h1>Segurança</h1>
  <p>O Delta foi construído para que um erro no código não exponha dados de outra agência.</p>
  <h2>Isolamento no banco de dados</h2>
  <p>Toda tabela com dados de agência tem Row Level Security no PostgreSQL. A aplicação conecta com um usuário que não consegue ignorar essas regras: se uma consulta esquecer um filtro, o banco devolve só os dados da agência certa. Um teste automático impede que uma tabela nova entre sem essa proteção.</p>
  <h2>Credenciais e tokens</h2>
  <ul class="check">
    <li>Tokens de acesso às plataformas e chaves dos apps ficam criptografados.</li>
    <li>Tokens de API, de convites e de links públicos são guardados só como hash.</li>
    <li>Webhooks de saída são assinados e não chegam a endereços internos.</li>
  </ul>
  <h2>Acesso das pessoas</h2>
  <ul class="check">
    <li>Verificação em duas etapas e passkeys.</li>
    <li>Papéis por agência (dono, administrador, analista e cliente) e portal do cliente só com os projetos dele.</li>
    <li>Registro de auditoria de quem fez o quê.</li>
  </ul>
  <h2>WhatsApp e e-mail com consentimento</h2>
  <p>Envios só para contatos com consentimento registrado, e descadastro em um clique.</p>
</article>''')

page('desenvolvedores.html', 'API, webhooks, MCP e Connect · Delta', 'API REST com tokens por escopo, webhooks assinados, servidor MCP para assistentes de IA, CLI e Delta Connect.', '''
<article class="post">
  <h1>Para desenvolvedores</h1>
  <h2>API REST v1</h2>
  <p>Tokens por agência com escopos (projetos, métricas, relatórios, webhooks), limite por token e os mesmos dados do app.</p>
  <h2>Webhooks</h2>
  <p>Eventos de relatório publicado, envio concluído, meta, conexão expirada, publicação de posts e mudanças em anúncios, com assinatura HMAC e novas tentativas.</p>
  <h2>Servidor MCP</h2>
  <p>Use os dados da agência no Claude, no Cursor e em outros assistentes: projetos, métricas, saúde da conta, metas e relatórios, com o escopo <code>mcp:tools</code>.</p>
  <h2>CLI</h2>
  <p><code>delta projects</code>, <code>delta metrics get</code>, <code>delta summary</code>: o Delta no terminal, com saída em tabela, JSON ou CSV.</p>
  <h2>Delta Connect</h2>
  <p>Para quem tem um SaaS: crie customers, deixe seus clientes conectarem as contas por uma página hospedada e consulte métricas unificadas, na hora ou por webhook. Cada customer fica isolado no próprio banco.</p>
</article>''')

GLOSSARY = [
    ('Alcance', 'Pessoas únicas que viram o anúncio ao menos uma vez no período. Não é a soma dos dias.'),
    ('Atribuição', 'Regra que decide a qual anúncio ou canal uma conversão é creditada (por exemplo, 7 dias após o clique).'),
    ('CPA', 'Custo por aquisição: investimento dividido pelas conversões.'),
    ('CPC', 'Custo por clique: investimento dividido pelos cliques.'),
    ('CPL', 'Custo por lead: investimento dividido pelos cadastros gerados.'),
    ('CPM', 'Custo por mil impressões.'),
    ('CTR', 'Taxa de cliques: cliques divididos pelas impressões, em percentual.'),
    ('Fase de aprendizado', 'Período em que a plataforma de anúncios testa entregas depois de mudanças grandes; o desempenho oscila mais.'),
    ('Frequência', 'Média de vezes que cada pessoa viu o anúncio: impressões divididas pelo alcance.'),
    ('Impressões', 'Quantas vezes o anúncio ou conteúdo foi exibido.'),
    ('Lookalike', 'Público semelhante a uma base de clientes, criado pela plataforma de anúncios.'),
    ('Margem bruta', 'Quanto sobra da receita depois do custo do produto, em percentual. Base do ROAS de equilíbrio.'),
    ('Orçamento na campanha (CBO)', 'A plataforma distribui o orçamento entre os conjuntos da campanha.'),
    ('Pixel', 'Código no site que registra visitas e conversões para as plataformas de anúncios.'),
    ('Remarketing', 'Anúncios para quem já interagiu com a marca, como visitantes do site.'),
    ('ROAS', 'Retorno sobre o investimento em anúncios: receita atribuída dividida pelo investimento.'),
    ('ROAS de equilíbrio', 'ROAS mínimo para não ter prejuízo: 1 dividido pela margem bruta.'),
    ('Taxa de conversão', 'Percentual dos cliques (ou sessões) que viraram conversão.'),
    ('Ticket médio', 'Receita dividida pelo número de pedidos.'),
    ('UTM', 'Parâmetros no link que dizem ao Analytics de onde veio a visita.'),
]
items = '\n'.join(f'<dt id="{t.lower().replace(" ", "-").replace("(", "").replace(")", "")}">{t}</dt><dd>{d}</dd>' for t, d in GLOSSARY)
page('glossario.html', 'Glossário de marketing digital · Delta', 'Termos de mídia paga e analytics explicados sem jargão: CPA, ROAS, CTR, frequência, atribuição e mais.', f'''
<article class="post"><h1>Glossário</h1><p>Os termos que aparecem nos relatórios, explicados em uma frase.</p><dl class="glossary">{items}</dl></article>''')

page('afiliados.html', 'Programa de afiliados · Delta', 'Indique o Delta para agências e ganhe comissão recorrente.', f'''
<article class="post">
  <h1>Programa de afiliados</h1>
  <p>Consultores, criadores de conteúdo e comunidades de marketing podem indicar o Delta e ganhar uma comissão recorrente sobre as assinaturas indicadas.</p>
  <ul class="check"><li>Link de indicação próprio.</li><li>Comissão enquanto a agência indicada continuar assinante.</li><li>Materiais de divulgação e acesso antecipado a novidades.</li></ul>
  <p class="note">Percentuais e regras em definição.</p>
  <p><a class="btn primary" href="mailto:parcerias@delta.local?subject=Programa%20de%20afiliados">Quero participar</a></p>
</article>''')

page('404.html', 'Página não encontrada · Delta', 'Esta página não existe.', '''
<section class="hero"><div class="wrap"><h1>Página não encontrada</h1><p class="lead">O endereço pode ter mudado.</p><a class="btn primary" href="/">Ir para o início</a></div></section>''')

# ---------------------------------------------------------------- Ferramentas

TOOLS = [
    ('roas-de-equilibrio.html', 'Calculadora de ROAS de equilíbrio', 'Descubra o ROAS mínimo para suas campanhas não darem prejuízo, a partir da margem bruta.'),
    ('cpa-maximo.html', 'Calculadora de CPA máximo', 'Quanto você pode pagar por venda sem perder dinheiro, e o CPA-alvo para manter o lucro desejado.'),
    ('preco-de-freela.html', 'Calculadora de preço de freela', 'Quanto cobrar por hora como freelancer de marketing, considerando renda, custos, férias e impostos.'),
    ('funil.html', 'Diagnóstico de funil', 'Veja as taxas de clique e de conversão da sua campanha e onde está o maior gargalo.'),
]
tool_cards = '\n'.join(f'<a class="card" href="/ferramentas/{slug}"><h3>{title}</h3><p>{desc}</p></a>' for slug, title, desc in TOOLS)
page('ferramentas/index.html', 'Ferramentas gratuitas de marketing · Delta', 'Calculadoras gratuitas para gestores de tráfego e agências: ROAS de equilíbrio, CPA máximo, preço de freela e funil.', f'''
<section class="hero"><div class="wrap"><h1>Ferramentas gratuitas</h1><p class="lead">Contas que todo gestor de tráfego faz, sem planilha e sem cadastro.</p></div></section>
<section class="band"><div class="wrap"><div class="grid">{tool_cards}</div></div></section>''')

calc_page('roas-de-equilibrio.html', TOOLS[0][1], TOOLS[0][2], '''
<form class="calc" id="f" novalidate>
  <label>Margem bruta (%) <input name="margin" type="number" inputmode="decimal" min="1" max="100" step="0.1" value="35" required><small>O que sobra da receita depois do custo do produto.</small></label>
</form>''', '''import { breakEvenRoas, format } from '/assets/calc.mjs';
const f = document.getElementById('f'); const out = document.getElementById('resultado');
const run = () => { const r = breakEvenRoas(Number(f.margin.value));
  out.innerHTML = r === null ? '<p>Informe uma margem entre 1% e 100%.</p>' : `<strong class="big">ROAS ${format.number(r)}</strong><p>Abaixo disso, cada real investido em anúncio traz prejuízo.</p>`; };
f.addEventListener('input', run); run();''', academy='roas-de-equilibrio.html')

calc_page('cpa-maximo.html', TOOLS[1][1], TOOLS[1][2], '''
<form class="calc" id="f" novalidate>
  <label>Ticket médio (R$) <input name="ticket" type="number" inputmode="decimal" min="0" step="0.01" value="180" required></label>
  <label>Margem bruta (%) <input name="margin" type="number" inputmode="decimal" min="1" max="100" step="0.1" value="40" required></label>
  <label>Lucro desejado por venda (% do ticket) <input name="profit" type="number" inputmode="decimal" min="0" max="100" step="0.1" value="10"></label>
</form>''', '''import { maxCpa, format } from '/assets/calc.mjs';
const f = document.getElementById('f'); const out = document.getElementById('resultado');
const run = () => { const r = maxCpa(Number(f.ticket.value), Number(f.margin.value), Number(f.profit.value || 0));
  out.innerHTML = r === null ? '<p>Confira os valores.</p>' : `<strong class="big">${format.money(r.target)} por venda</strong><p>CPA-alvo para manter o lucro desejado. O limite para empatar é ${format.money(r.breakEven)}.</p>`; };
f.addEventListener('input', run); run();''', academy='roas-de-equilibrio.html')

calc_page('preco-de-freela.html', TOOLS[2][1], TOOLS[2][2], '''
<form class="calc" id="f" novalidate>
  <label>Renda líquida desejada por mês (R$) <input name="income" type="number" inputmode="decimal" min="0" step="50" value="8000"></label>
  <label>Custos mensais do trabalho (R$) <input name="costs" type="number" inputmode="decimal" min="0" step="10" value="900"><small>Ferramentas, internet, equipamento, contador.</small></label>
  <label>Horas faturáveis por semana <input name="hours" type="number" inputmode="decimal" min="1" max="80" step="1" value="25"><small>Só as horas cobradas do cliente (sem prospecção e administrativo).</small></label>
  <label>Semanas sem trabalhar por ano <input name="off" type="number" inputmode="decimal" min="0" max="40" step="1" value="5"></label>
  <label>Impostos sobre o faturamento (%) <input name="tax" type="number" inputmode="decimal" min="0" max="60" step="0.5" value="6"></label>
</form>''', '''import { freelanceRate, format } from '/assets/calc.mjs';
const f = document.getElementById('f'); const out = document.getElementById('resultado');
const run = () => { const r = freelanceRate({ monthlyIncome: Number(f.income.value), monthlyCosts: Number(f.costs.value || 0), billableHoursPerWeek: Number(f.hours.value), weeksOff: Number(f.off.value || 0), taxPct: Number(f.tax.value || 0) });
  out.innerHTML = r === null ? '<p>Confira os valores.</p>' : `<strong class="big">${format.money(r.hourly)} por hora</strong><p>Faturamento médio de ${format.money(r.monthlyRevenue)} por mês em ${format.number(r.billableHours)} horas faturáveis no ano.</p>`; };
f.addEventListener('input', run); run();''')

calc_page('funil.html', TOOLS[3][1], TOOLS[3][2], '''
<form class="calc" id="f" novalidate>
  <label>Impressões <input name="impressions" type="number" inputmode="numeric" min="0" step="1" value="50000"></label>
  <label>Cliques <input name="clicks" type="number" inputmode="numeric" min="0" step="1" value="450"></label>
  <label>Conversões <input name="conversions" type="number" inputmode="numeric" min="0" step="1" value="9"></label>
  <label>CTR de referência (%) <input name="refCtr" type="number" inputmode="decimal" min="0.01" step="0.01" value="1.2"></label>
  <label>Taxa de conversão de referência (%) <input name="refCvr" type="number" inputmode="decimal" min="0.01" step="0.01" value="2.5"></label>
</form>''', '''import { funnel, format } from '/assets/calc.mjs';
const f = document.getElementById('f'); const out = document.getElementById('resultado');
const run = () => { const r = funnel({ impressions: Number(f.impressions.value), clicks: Number(f.clicks.value), conversions: Number(f.conversions.value) }, { ctr: Number(f.refCtr.value), conversionRate: Number(f.refCvr.value) });
  out.innerHTML = r === null ? '<p>Confira os números (cliques não passam das impressões, conversões não passam dos cliques).</p>'
    : `<strong class="big">CTR ${format.percent(r.ctr)} · conversão ${format.percent(r.conversionRate)}</strong><p>${r.bottleneck === null ? 'As duas etapas estão acima das referências.' : `O maior gargalo está na etapa de <b>${r.bottleneck}</b>.`}</p>`; };
f.addEventListener('input', run); run();''')

# ---------------------------------------------------------------- Academy

ARTICLES = [
    ('roas-de-equilibrio.html', 'ROAS de equilíbrio: o número que separa lucro de prejuízo', 'Por que um ROAS 2 pode dar prejuízo, e como calcular o mínimo de cada cliente a partir da margem.', '''
<p>ROAS (retorno sobre o investimento em anúncios) é a receita atribuída dividida pelo investimento. Um ROAS 3 parece ótimo, mas depende de quanto sobra de cada venda.</p>
<h2>A conta</h2>
<p>Se a margem bruta é de 35%, cada R$ 100 vendidos deixam R$ 35 para pagar o anúncio. Para empatar, o anúncio pode custar no máximo R$ 35, ou seja, o ROAS precisa ser de pelo menos 100 ÷ 35 = 2,86.</p>
<p>Abaixo do ROAS de equilíbrio, a campanha está pagando para vender. Acima dele, sobra lucro.</p>
<h2>Na prática</h2>
<ul><li>Pergunte a margem bruta ao cliente e registre no projeto.</li><li>Compare o ROAS de cada campanha com o de equilíbrio, não com uma média de mercado.</li><li>Lembre que o ROAS das plataformas usa a atribuição delas: confira com as vendas reais.</li></ul>
<p>No Delta, a margem do projeto alimenta o semáforo de atenção: quando o ROAS fica abaixo do equilíbrio, o alerta aparece com a sugestão de onde cortar.</p>
<p><a href="/ferramentas/roas-de-equilibrio.html">Use a calculadora de ROAS de equilíbrio</a>.</p>'''),
    ('semaforo-de-atencao.html', 'Semáforo de atenção: o que cada cor quer dizer', 'Como o Delta decide o que é crítico, o que merece atenção e o que é oportunidade.', '''
<p>Relatório com 40 números não diz por onde começar. O semáforo de atenção resume o que mudou e o que fazer.</p>
<h2>As três fontes de sinal</h2>
<ul><li><b>Boas práticas de mídia:</b> frequência alta demais, CTR baixo, CPM subindo, ROAS abaixo do equilíbrio.</li><li><b>Referências do nicho:</b> custo por clique e taxas fora da faixa típica do segmento do cliente.</li><li><b>Histórico do próprio cliente:</b> quando um número foge do padrão das últimas semanas.</li></ul>
<h2>As cores</h2>
<ul><li><b>Crítico:</b> perdendo dinheiro ou dados agora (conversões pararam, prejuízo).</li><li><b>Atenção:</b> tendência ruim que vale olhar nesta semana.</li><li><b>Oportunidade:</b> algo que pode render mais se você agir.</li></ul>
<p>Cada sinal vem com a explicação em números e uma sugestão. Ao transformar a sugestão em ação, o Delta mede o resultado 14 dias depois.</p>'''),
    ('relatorio-no-whatsapp.html', 'Relatório no WhatsApp: boas práticas e consentimento', 'Como enviar relatórios pelo WhatsApp sem virar spam e dentro das regras da Meta.', '''
<p>O cliente lê o WhatsApp antes do e-mail. Mas mensagem automática sem cuidado vira bloqueio.</p>
<h2>Regras que importam</h2>
<ul><li><b>Consentimento:</b> envie só para quem aceitou receber, e registre quando e como.</li><li><b>Templates aprovados:</b> fora da janela de 24 horas da última mensagem do cliente, a Meta só permite templates aprovados.</li><li><b>Descadastro fácil:</b> a pessoa responde "PARAR" e não recebe mais.</li></ul>
<h2>O que funciona</h2>
<ul><li>Mensagem curta com o principal resultado e um link para o relatório completo.</li><li>Frequência previsível: semanal ou mensal, sempre no mesmo dia.</li><li>Responder às dúvidas pela caixa de respostas, dentro da janela de 24 horas.</li></ul>'''),
]
article_cards = '\n'.join(f'<a class="card" href="/academy/{slug}"><h3>{title}</h3><p>{desc}</p></a>' for slug, title, desc, _ in ARTICLES)
page('academy/index.html', 'Academy · Delta', 'Artigos curtos sobre relatórios, mídia paga e atendimento ao cliente para agências.', f'''
<section class="hero"><div class="wrap"><h1>Academy</h1><p class="lead">Conteúdo direto ao ponto para quem faz relatório e gestão de mídia todo dia.</p></div></section>
<section class="band"><div class="wrap"><div class="grid">{article_cards}</div><p><a href="/glossario.html">Glossário de termos</a></p></div></section>''')
for slug, title, desc, body in ARTICLES:
    page(f'academy/{slug}', f'{title} · Academy Delta', desc, f'<article class="post"><p class="eyebrow">Academy</p><h1>{title}</h1>{body}</article>',
         schema={'@context': 'https://schema.org', '@type': 'Article', 'headline': title, 'inLanguage': 'pt-BR', 'description': desc})

# ---------------------------------------------------------------- Arquivos de apoio

(ROOT / 'assets' / 'icone.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0a84ff"/><path d="M32 14 50 48H14z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/></svg>\n', encoding='utf-8')
(ROOT / 'robots.txt').write_text(f'User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n', encoding='utf-8')
pages = sorted(str(p.relative_to(ROOT)) for p in ROOT.rglob('*.html') if p.name != '404.html')
urls = '\n'.join(f'  <url><loc>{SITE_URL}/{p.removesuffix("index.html")}</loc></url>' for p in pages)
(ROOT / 'sitemap.xml').write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}\n</urlset>\n', encoding='utf-8')
print(f'{len(pages) + 1} páginas geradas em {ROOT}')
