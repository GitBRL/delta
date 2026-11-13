# Delta — Planejamento do Sistema (v0.2)

> Plataforma de relatórios, dashboards e inteligência de marketing para agências e empresas.
> Escopo: **paridade com todos os serviços do Reportei** + uma camada própria de inteligência (indicadores personalizados, alertas de atenção, sugestões de melhoria) + WhatsApp como canal principal.
> Documento vivo: cada decisão tomada vira uma ADR em `docs/adr/`.
> Última atualização: 12/11/2026 · Andamento na §16

---

## 0. Resumo

| Item | Definição |
|---|---|
| Escopo | Todos os produtos e todas as APIs do Reportei (§1), em fases (§14) |
| Diferencial 1 | **Inteligência de marketing:** indicadores personalizados por fórmula, semáforo de atenção baseado em boas práticas e no histórico do próprio cliente, sugestões de melhoria com medição de impacto (§7) |
| Diferencial 2 | **WhatsApp de primeira classe:** cartão visual, PDF, aprovação antes do envio, status de leitura, relatório sob demanda (§6) |
| Diferencial 3 | **UX no nível Apple:** design system próprio inspirado no HIG, animações com propósito, 3 passos até o primeiro envio (§12) |
| Diferencial 4 | **Segurança multi-tenant no banco:** PostgreSQL RLS, fail-closed, desde o primeiro commit (§5) |
| Backend | PHP + Laravel + Eloquent, Octane/FrankenPHP |
| Banco | PostgreSQL 18 (RLS, particionamento, `uuidv7()` nativo) |
| Cache / filas | Valkey (compatível com Redis) + Laravel Horizon + Transactional Outbox no Postgres |
| Tempo real | Laravel Reverb (WebSocket) |
| Frontend | Angular (standalone, Signals, zoneless) + design system próprio |
| APIs | API REST pública (OpenAPI), webhooks assinados, servidor MCP, CLI, e o "Delta Connect" para outros SaaS |

---

## 1. Levantamento: tudo o que o Reportei oferece (nov/2026)

### 1.1 Produtos

| # | Serviço Reportei | O que faz | Módulo Delta | Fase |
|---|---|---|---|---|
| 1 | Relatórios | Junta vários canais; métricas personalizáveis; análises em texto, imagem ou vídeo; comparação de períodos; modelos prontos; PDF, link ou WhatsApp | Reports | 1 |
| 2 | Dashboards | Indicadores ao vivo (social, tráfego pago, e-commerce, CRM), período de comparação por projeto | Dashboards | 2 |
| 3 | Overview | Principais métricas de todos os projetos em uma tela | Overview | 1 |
| 4 | Automação de relatórios | Semanal, quinzenal ou mensal por e-mail ou WhatsApp; tipo *relatório* (link) ou *resumo* (métricas no texto); até 3 números; webhook (texto/JSON) para Zapier/Make/n8n | Automations + Messaging | 1 |
| 5 | Reportei AI | Copiloto de análises e insights | AI | 2 |
| 6 | Reportei Studio | Apresentações (página única ou slides) geradas por IA a partir de descrição, ajustes por chat | Studio | 3 |
| 7 | Reportei Controle | Metas e KPIs por cliente, alertas ao longo do mês | Goals | 2 |
| 8 | Linha do Tempo | Marcos por projeto, compartilhável por link | Timeline | 2 |
| 9 | Flux | Agendamento de posts, calendário, tarefas, aprovação de conteúdo | Publishing | 3 |
| 10 | Sync | Exporta dados dos canais para Google Sheets | Sync | 3 |
| 11 | MCP | Dados do Reportei dentro de assistentes de IA (Claude, Cursor...) | Mcp | 3 |
| 12 | CLI | Terminal para projetos, relatórios, métricas, metas, automações | Cli | 3 |
| 13 | API v2 | API REST do app | PublicApi | 2 |
| 14 | Connect | API para outros SaaS: métricas unificadas, posts, gestão de Meta Ads, mídia, toolkits, gateway de LLM, webhooks | Connect | 4 |
| 15 | Academy, ferramentas gratuitas (calculadoras de freela e ROI, benchmarking de funil, gerador de contratos e de username), afiliados, webinars, glossário | Aquisição e conteúdo | Site de marketing | 4 |

Não confirmado nas fontes públicas: white label / domínio próprio, e preços (os planos se chamam Starter, PRO e Premium; a página de preços não mostra valores).

### 1.2 API v2 do app (`https://app.reportei.com/api/v2`)

Bearer token gerado em Configurações da Empresa.

| Recurso | Endpoints |
|---|---|
| Empresa | `GET /companies/settings` (inclui `rate_limits`) |
| Projetos | `GET /projects`, `GET /projects/{id}` |
| Integrações | `GET /integrations` (filtros `project_id`, `name`, `slug`), `GET /integrations/{id}` |
| Métricas | `GET /metrics?integration_slug=`, `POST /metrics/get-data` (`start`, `end`, `integration_id`, `metrics`, comparação opcional) |
| Templates | `GET /templates`, `GET /templates/{id}` |
| Relatórios | `GET /reports`, `GET /reports/{id}`, `POST /reports` (`title`, `subtitle`, `start`, `end`, `template_id`, `integration_ids`, `project_id`) |
| Dashboards | `GET /dashboards`, `GET /dashboards/{id}`, `POST /dashboards` |
| Webhooks | `GET/POST /webhooks`, `GET/PUT/DELETE /webhooks/{id}`, `GET /webhooks/events` |
| Linha do tempo | `GET/POST /timeline-events`, `GET/PUT/DELETE /timeline-events/{id}` (conteúdo em HTML) |

- **Eventos de webhook:** `report_viewed`, `report_created`, `dashboard_created`, `automation_executed`, `control_goal_met`, `control_goal_not_met`, `timeline_milestone_added`.
- **Limites:** global por token (ex.: 150/min e 15/s); `metrics/get-data` 100/min por empresa; criação de relatório/dashboard: o maior entre 30/dia e 2 por projeto ativo. Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`.
- **Paginação:** `page`, `per_page` (máx. 100), `sortBy`, `descending`, `q`.

### 1.3 MCP Server (`https://app.reportei.com/mcp`)

Streamable HTTP; OAuth 2.1 com PKCE e registro dinâmico de cliente; escopo `mcp:tools`. Exige plano pago e ao menos uma integração conectada.

| Grupo | Tools (38) |
|---|---|
| Empresa e projetos | `get_company_settings`, `list_projects`, `get_project` |
| Integrações e métricas | `list_integrations`, `get_integration`, `list_metrics`, `get_metrics_data` |
| Relatórios e dashboards | `list_reports`, `get_report`, `create_report`, `list_dashboards`, `get_dashboard`, `create_dashboard`, `list_templates` |
| Análises | `get_performance_summary`, `compare_periods`, `get_top_content`, `get_channel_breakdown`, `get_campaign_summary`, `get_audience_insights` |
| Metas | `list_goals`, `get_goal_progress`, `create_goal`, `update_goal` |
| Automações | `list_automations`, `get_automation`, `create_automation`, `update_automation`, `toggle_automation` |
| Linha do tempo | `list_timeline_events`, `get_timeline_event`, `create_timeline_event`, `update_timeline_event`, `delete_timeline_event` |
| Webhooks | `list_webhooks`, `create_webhook`, `update_webhook`, `delete_webhook` |

Prompts prontos: `marketing-review`, `social-audit`, `campaign-analysis`, `seo-check`, `monthly-report`.

### 1.4 CLI (`@reportei/cli`, v0.3.1)

Node 20+, fala com o mesmo servidor MCP. Login por OAuth Device Flow; perfis múltiplos; saída em tabela, `--json`, `--csv`, `--raw`; modo interativo (REPL) com autocompletar.

Grupos de comandos: `auth`, `myCompany`, `projects`/`project use`, `integrations` (inclui `catalog`), `metrics`, `reports`, `dashboards`, `templates`, `analyze` (performance, channels, campaigns, content), `compare`, `goals`, `automations`, `timeline`, `webhooks`, `prompt`/`prompts`, `config`, `interactive`.

### 1.5 Reportei Connect (`https://connect.reportei.com/api`)

API para outros SaaS. Modelo: *merchant* (o SaaS) → *customers* (os clientes dele) → *customer integrations* (contas conectadas).

| Recurso | Endpoints e regras |
|---|---|
| Autenticação | Bearer do merchant + `x-customer-token` (gerado uma única vez na criação do customer, irrecuperável) |
| Merchants | `settings`, `stats`, visão de anúncios, posts, mídias e execuções de todos os customers; `credentials/{slug}` para app próprio (Meta ou toolkit OAuth) |
| Integrações | `GET /integrations` (catálogo: 156, das quais ~100 são toolkits) |
| Customers | CRUD em `/customers` |
| Conexão | `POST /customer-integrations/session` (tela hospedada de OAuth); status `active`, `expired`, `revoked` |
| Métricas | `GET /metrics/{slug}`; `POST /metrics/get-data` (síncrono) e `get-data-async` (entrega no `metrics_webhook_url`). Cada métrica: `reference_key` (ex.: `fb_ads:reach`), `component` (`number_v1`, `chart_v1`, `datatable_v1`), `dimensions`, `entity_id`/`entity_type` |
| Anúncios (só Meta) | CRUD e duplicação de campanhas, conjuntos e anúncios; `boost`, `validate`; públicos, busca de segmentação, páginas, contas de Instagram, pixels e eventos, conversões personalizadas; `Idempotency-Key` obrigatória |
| Mídia | Upload único (até 8 MB) ou em partes (até 1 GB); expira em 30 dias |
| Posts | Instagram (feed, carrossel, reels, story), Facebook (feed, reels, story), Threads, LinkedIn (texto, imagens, vídeo, documento), Pinterest (com boards), YouTube Shorts. `Idempotency-Key`, `external_reference`, status de publicação por rede |
| Toolkits | Catálogo, tools por toolkit, conexão (`api_key`, `basic`, `oauth2`), `POST /tools/{slug}/execute` sem retry automático. ~1.184 tools em ~100 apps (Slack, Gmail, Notion, Jira, WhatsApp Cloud API, Stripe...) |
| LLM | Gateway compatível com o SDK da OpenAI; chave própria (OpenAI/Anthropic) guardada cifrada; até 3 modelos de fallback; streaming; tools |
| Webhooks | Até 5 endpoints; eventos `post.*`, `customer_integration.status_updated`/`.deleted`, `integration_session.*`; assinatura `Connect-Signature: t=...,v1=...` (HMAC-SHA256 de `{t}.{corpo}`, tolerância 5 min); retries por ~3 dias; rotação de segredo, teste, histórico e reenvio |
| Limites | Por merchant e por funcionalidade (métricas, LLM, tools, posts, anúncios); 429 com `Retry-After` |
| Extras | Explorer web, coleção Postman, OpenAPI, prompt pronto para implementar com agente de código |

### 1.6 Integrações de dados do app (53)

| Categoria | Plataformas | Fase |
|---|---|---|
| Ads | Meta Ads, Google Ads, Microsoft Ads, X Ads, Kwai Ads, Spotify Ads, ChatGPT Ads, Google Local Services | Meta e Google = 1; demais 2–3 |
| Redes sociais | Instagram, Facebook, Threads, YouTube, LinkedIn (+Ads), TikTok (+Ads), Pinterest (+Ads) | Instagram e Facebook = 1; TikTok, LinkedIn, YouTube = 2; demais 3 |
| Analytics e SEO | Google Analytics 4, Search Console, Google Meu Negócio, Ahrefs, Keyword.com | GA4 = 1; GSC e GMN = 2; demais 3 |
| CRM | RD Station CRM e Marketing, HubSpot Marketing e Sales, Pipedrive, Kommo, GoHighLevel | RD e HubSpot = 2; demais 3 |
| E-commerce e vendas | Shopify, Nuvemshop, WooCommerce, Magazord, Olist, iFood, Cardápio Web, Repediu, Hotmart, Kiwify, Eduzz | Shopify, Nuvemshop, WooCommerce, Hotmart, Kiwify = 2; demais 3 |
| E-mail marketing | Mailchimp, ActiveCampaign, E-goi, Klaviyo | 3 |
| Automação | n8n, Make, Zapier, Pluga | 2 (via webhooks e API) |
| Outros | Google Sheets, Airtable, NAMTAB, GreatPages, Phonetrack, CallRail, Twilio | Sheets/CSV como fonte manual = 1; demais 3 |

### 1.7 Onde o Delta supera

| Reportei | Delta |
|---|---|
| Até 3 números por automação | Contatos ilimitados (limite só por plano) |
| WhatsApp manda link ou resumo em texto | Texto, cartão visual, PDF e link, combináveis |
| Envio sempre automático | "Revisar antes de enviar" com aprovação em 1 toque |
| Opt-out cancela todas as automações do contato | Opt-out por projeto ou global, à escolha do contato |
| Métricas do catálogo | **Indicadores personalizados** por fórmula, inclusive cruzando plataformas |
| Alertas de meta (Controle) | **Semáforo de atenção** por boas práticas, histórico e metas, com explicação |
| Insights de IA | **Sugestões de melhoria** com plano de ação e medição do resultado depois de aplicadas |
| — | Saúde de cada conta na Overview ("Radar") |
| — | Cliente pede "relatório" no WhatsApp e recebe na hora |
| — | Aprovação de posts pelo cliente via WhatsApp |
| — | Importador: traz projetos, templates e linha do tempo do Reportei pela API v2 com o token do próprio usuário |

Replicar funcionalidades é legítimo; textos, marca, layout e templates do Reportei não devem ser copiados.

---

## 2. Escopo funcional completo do Delta

| Área | Funcionalidades |
|---|---|
| Conta | Agências (tenants), usuários, papéis, convites, 2FA, passkeys, white label (logo, cores, domínio, remetente de e-mail, número de WhatsApp) |
| Projetos | Cliente final da agência; contatos com opt-in; configurações de negócio (nicho, margem bruta, ticket médio, metas) usadas pela inteligência |
| Integrações | 53 fontes de dados + fonte manual/planilha; saúde da conexão |
| Relatórios | Builder, templates por nicho, análises em texto/imagem/vídeo, comparação, snapshot imutável, link público, PDF |
| Dashboards | Ao vivo, embed autorizado, TV mode |
| Overview | Todos os projetos, com Radar de saúde |
| Automações | E-mail, WhatsApp e webhook; relatório ou resumo; gatilhos por agenda ou evento |
| Inteligência | Indicadores personalizados, semáforo de atenção, sugestões, plano de ação, saúde da conta (§7) |
| IA | Copiloto de análise, textos de análise sugeridos, Studio de apresentações |
| Metas | KPIs por projeto, progresso, alertas |
| Linha do tempo | Marcos manuais e automáticos (ex.: "campanha X iniciada", "sugestão aplicada") |
| Publicação (Flux) | Calendário editorial, agendamento multi-rede, aprovação de conteúdo (inclusive via WhatsApp), tarefas/kanban |
| Anúncios | Gestão de Meta Ads (criar, duplicar, pausar, impulsionar) |
| Sync | Exportação agendada para Google Sheets |
| Plataforma | API REST, webhooks, MCP, CLI, Connect, importador do Reportei |
| Aquisição | Academy, ferramentas gratuitas, afiliados (site de marketing, fora do app) |

---

## 3. Princípios de arquitetura

1. **Seguro por padrão (fail-closed):** sem contexto de tenant, o banco devolve zero linhas.
2. **Simplicidade radical para o usuário:** 3 passos até o primeiro relatório no WhatsApp.
3. **Monolito modular primeiro:** um deploy, módulos com fronteiras claras; extrair serviço só com dor medida.
4. **Núcleo de dados com contrato público desde o dia 1:** conectores, métricas e publicação usam internamente o mesmo contrato que o Connect vai expor. O Connect passa a ser "abrir a porta", não reconstruir.
5. **Uma superfície para agentes:** CLI e integrações de IA falam com o servidor MCP, que fala com os mesmos serviços da API.
6. **Tudo que fala com API externa é assíncrono**, idempotente e com retry.
7. **O que foi enviado ao cliente é imutável:** todo envio gera um snapshot congelado.
8. **IA nunca inventa número:** o modelo recebe fatos calculados e só pode citar esses fatos (§7.5).

---

## 4. Arquitetura

```
  Navegador          Assistentes IA       Terminal          Outros SaaS
  (agência/cliente)  (Claude, Cursor)     (delta CLI)       (Connect)
        │                   │                  │                 │
        │            ┌──────▼──────────────────▼──┐              │
        │            │ Servidor MCP (OAuth 2.1)   │              │
        │            └──────────────┬─────────────┘              │
┌───────▼────────────┐              │              ┌─────────────▼──────┐
│ Angular SPA        │              │              │ API Connect        │
│ + SSR em /r/:token │              │              │ (merchant/customer)│
└───────┬────────────┘              │              └─────────────┬──────┘
        │ REST + WebSocket          │                            │
┌───────▼───────────────────────────▼────────────────────────────▼──────┐
│ Laravel (Octane/FrankenPHP)                                           │
│ API interna · API pública v1 · Sanctum/Passport · Policies · ctx RLS  │
│ Módulos: Tenancy · Projects · Integrations · Metrics · Insights ·     │
│ Reports · Dashboards · Automations · Messaging · Goals · Timeline ·   │
│ AI · Studio · Publishing · Ads · Media · Sync · Webhooks · Audit      │
└───┬──────────────────┬──────────────────┬─────────────────────────────┘
    │                  │                  │
┌───▼──────────┐ ┌─────▼──────┐ ┌─────────▼───┐
│ PostgreSQL 18│ │ Valkey     │ │ Reverb (WS) │
│ RLS · outbox │ │ cache·fila │ └─────────────┘
│ partições    │ │ locks·rate │
└───▲──────────┘ └─────▲──────┘
    │                  │
┌───┴──────────────────┴────────────────────────────────────────┐
│ Workers Horizon + Scheduler                                   │
│ sync-* · insights · render · whatsapp · mail · ai · publish · │
│ ads · webhooks-out · sheets                                   │
└──┬──────────────┬─────────────┬──────────────┬────────────────┘
   │              │             │              │
 APIs das      Gotenberg     WhatsApp       LLM (Claude)
 plataformas   (PDF/PNG)     Cloud API      e gateway
                  │             │
               S3/MinIO     webhooks de status
```

### 4.1 Stack

| Camada | Tecnologia | Motivo |
|---|---|---|
| Linguagem/framework | PHP 8.4+ / Laravel (estável vigente no scaffold) | Pedido; filas, auth, broadcasting nativos |
| ORM | Eloquent | Pedido; SQL puro nas migrations de segurança (RLS) |
| Runtime | Octane + FrankenPHP | Latência baixa; exige reset de estado entre requests (§5.1) |
| Banco | PostgreSQL 18 | RLS, particionamento, JSONB, `uuidv7()` nativo |
| Cache, locks, rate limit | Valkey | Cache de métricas, locks de refresh de token, throttle por provedor |
| Filas | Laravel Horizon sobre Valkey | Nativo, painel, balanceamento automático |
| Eventos críticos | Transactional Outbox no Postgres | WhatsApp e webhooks nunca se perdem, mesmo se o Valkey cair |
| Tempo real | Laravel Reverb + Echo | Progresso de sincronização, status de entrega ao vivo |
| Auth de usuário | Sanctum (cookie SPA), Fortify (2FA TOTP), passkeys (WebAuthn), Socialite | §5.2 |
| Auth de API/MCP/CLI | Laravel Passport: tokens pessoais com escopos, OAuth 2.1 + PKCE, Device Flow | Mesmo modelo do Reportei (MCP com OAuth, CLI com device flow) |
| Servidor MCP | `laravel/mcp` | MCP nativo no Laravel, reaproveitando serviços e políticas |
| Documentação de API | OpenAPI gerado do código (Scramble) + coleção Postman + explorer | Paridade com o Connect |
| HTTP das integrações | Saloon | OAuth2, rate limit, retry, fixtures gravadas |
| Fórmulas | Parser próprio (AST) com funções em lista branca | §7.1; nunca `eval` |
| PDF / imagem | Gotenberg (Chromium headless) | Renderiza a rota Angular de impressão |
| Arquivos | S3 compatível (MinIO em dev), upload multipart por URL assinada | Mídias de até 1 GB (posts/anúncios) |
| IA | Claude (Anthropic) via API | Sugestões, análises, Studio; só dados agregados, sem dados pessoais |
| Frontend | Angular, NgRx SignalStore, Angular CDK, Tailwind CSS v4 (tokens), ECharts, GSAP | §12 |
| CLI | TypeScript/Node publicado no npm, cliente do servidor MCP | Paridade com `@reportei/cli` |
| Observabilidade | OpenTelemetry → Grafana (Prometheus/Loki/Tempo) ou Sentry; Laravel Pulse | Rastrear um envio de ponta a ponta |
| Qualidade | Pest, Larastan (nível máximo), Pint, Rector; Vitest + Playwright; Storybook | CI bloqueia merge |
| Infra | Docker Compose (dev); containers + Postgres gerenciado (prod); CI local (`make ci`) — nada publicado no GitHub | — |

Se surgirem consumidores em outras linguagens ou roteamento complexo de eventos, troca-se o driver de fila para RabbitMQ sem reescrever os Jobs.

### 4.2 Módulos do backend (`backend/app/Domain/`)

| Módulo | Responsabilidade |
|---|---|
| Tenancy | Agências, usuários, papéis, convites, white label, contexto RLS |
| Projects | Projetos, contatos, consentimentos, perfil de negócio (nicho, margem, ticket) |
| Integrations | Conectores, OAuth, contas descobertas, saúde da conexão |
| Metrics | Catálogo, ingestão, consulta unificada, cache, fonte manual |
| Insights | Indicadores personalizados, motor de regras, benchmarks, anomalias, sugestões, plano de ação, saúde da conta |
| Reports | Builder, templates, snapshots, links públicos, PDF |
| Dashboards | Dashboards ao vivo, embed, Overview |
| Automations | Agendamentos, gatilhos por evento, execuções |
| Messaging | WhatsApp, e-mail, outbox, webhooks de entrada, opt-in/opt-out, caixa de respostas |
| Goals | Metas, progresso, alertas |
| Timeline | Marcos manuais e automáticos |
| AI | Copiloto, textos de análise, guardrails |
| Studio | Apresentações geradas por IA |
| Publishing | Calendário, posts multi-rede, aprovação, tarefas |
| Ads | Gestão de Meta Ads |
| Media | Upload multipart, biblioteca de mídia |
| Sync | Exportação para Google Sheets |
| PublicApi | API v1, tokens, escopos, limites |
| Webhooks | Endpoints de saída, assinatura, entregas, reenvio |
| Mcp | Tools e prompts MCP |
| Connect | Merchants, customers, sessões hospedadas, toolkits, gateway de LLM |
| Importer | Importação de dados do Reportei via API v2 |
| Billing | Planos, limites, consumo (WhatsApp, IA, conexões) |
| Audit | Log append-only |

### 4.3 Filas

| Fila | O que roda | Controle |
|---|---|---|
| `sync-{provedor}` | Coleta de métricas | Rate limit por app e por conta; jitter na madrugada |
| `insights` | Avaliação de regras e anomalias após cada sync | Debounce por projeto |
| `render` | Snapshot, PNG do cartão, PDF | Concorrência limitada pelo Gotenberg |
| `whatsapp` | Despacho do outbox | Throughput por número remetente |
| `publish` | Posts agendados | Limites de cada rede; idempotência por `external_reference` |
| `ads` | Operações de Meta Ads | `Idempotency-Key`; limites da Marketing API |
| `webhooks-out` | Entrega de webhooks | Backoff por até 3 dias; desativação automática |
| `ai` | Sugestões, análises, Studio | Timeout e orçamento por tenant |
| `mail`, `sheets`, `default` | Demais | — |

Todo job tem chave de idempotência, retry com backoff exponencial, fila de falhas (DLQ) e `tenant_id` serializado.

---

## 5. Segurança desde o início

### 5.1 Multi-tenant com Row Level Security (camada principal)

**Modelo:** um banco, um schema, coluna `tenant_id uuid` em toda tabela de negócio. O banco é a fonte da verdade do isolamento; o código é a segunda camada.

| Role do Postgres | Uso | Atributos |
|---|---|---|
| `delta_owner` | Dona das tabelas, roda migrations | Nunca usada em runtime |
| `delta_app` | API e workers | `NOBYPASSRLS`, não é dona de tabela, sem DDL |
| `delta_admin` | Backoffice/suporte | `BYPASSRLS`, conexão separada, toda ação auditada |
| `delta_readonly` | BI interno | Somente leitura, sujeita a RLS |

**Política padrão (aplicada por migration a toda tabela com `tenant_id`)**

```sql
CREATE SCHEMA app;

-- NULLIF: depois de um RESET a variável volta como '' (não NULL); o cast para uuid falharia.
CREATE FUNCTION app.current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON reports
  USING      (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE reports ALTER COLUMN tenant_id SET DEFAULT app.current_tenant();
```

Sem contexto definido, `app.current_tenant()` é `NULL`, a comparação nunca é verdadeira e o resultado é zero linhas.

**Papel "Cliente" (portal do cliente):** política `RESTRICTIVE` adicional, limitada aos projetos dos quais o usuário é membro. Políticas permissivas se combinam com OU; a restritiva se combina com E, então não amplia acesso por engano.

```sql
CREATE POLICY client_scope ON reports AS RESTRICTIVE
  USING (app.is_staff() OR project_id IN (
    SELECT project_id FROM project_members WHERE user_id = app.current_user_id()
  ));
```

**Contexto no Laravel**

- Middleware `ResolveTenant` (depois da autenticação): confirma que o usuário pertence ao tenant e executa `select set_config('app.tenant_id', ?, false)` e `app.user_id`.
- Reset obrigatório no fim de cada request (listener de `RequestTerminated` do Octane), porque a conexão persiste entre requests.
- Job middleware `TenantAware`: todo job carrega o `tenant_id`, define o contexto ao iniciar e reseta ao terminar.
- API pública, MCP e CLI: o token (Passport) carrega o tenant; o mesmo middleware define o contexto.
- Connect: o merchant é um tenant; o `x-customer-token` restringe ao projeto (customer) via política `RESTRICTIVE`.
- Trait `BelongsToTenant` nos models (global scope + preenchimento) como segunda camada.
- Pooling: **não** usar PgBouncer em modo *transaction* com variável de sessão; se necessário, migrar para `SET LOCAL` dentro de transação por request.
- Tabelas particionadas: políticas no pai; revogar de `delta_app` o acesso direto às partições.
- Views com `security_invoker = true`. Evitar materialized views com dados de tenant (não suportam RLS).
- Tabelas globais sem tenant (catálogo de métricas, regras padrão, benchmarks agregados): somente leitura para `delta_app`.

**Links públicos (`/r/:token`):** token aleatório guardado só como hash SHA-256 em `share_links`. Uma função `SECURITY DEFINER` resolve o hash e devolve apenas `tenant_id` + `snapshot_id`; o contexto é definido em modo somente leitura. Senha e expiração opcionais.

**Testes que bloqueiam o CI**

1. Cobertura: falha se existir tabela com `tenant_id` sem RLS habilitada, sem `FORCE` ou sem política.
2. Suíte cross-tenant: tenants A e B; tentar ler, alterar e apagar dados de B autenticado como A em todos os endpoints da API interna, API pública, MCP e Connect.
3. Vazamento no Octane: requests alternados de tenants diferentes no mesmo worker.

### 5.2 Demais controles

| Área | Controle |
|---|---|
| Autenticação | Sanctum com cookies HttpOnly/Secure/SameSite, CSRF; 2FA TOTP obrigatório para Owner/Admin; passkeys; bloqueio progressivo; sessões revogáveis |
| Autorização | Papéis por tenant (Owner, Admin, Analista, Cliente) via Policies + spatie/laravel-permission (modo *teams*) |
| Tokens de API | Escopos mínimos por token; exibidos uma única vez; guardados como hash; expiração; último uso visível; revogação |
| Tokens OAuth das integrações | Criptografados em repouso (cast `encrypted`; depois envelope com chave por tenant em KMS/Vault); refresh com lock distribuído |
| Chaves de LLM do cliente (Connect) | Cifradas; só os 4 últimos caracteres exibidos |
| Webhooks de entrada | Validação de assinatura (`X-Hub-Signature-256` da Meta), idempotência por ID, anti-replay |
| Webhooks de saída | Assinatura `Delta-Signature: t=...,v1=...` (HMAC-SHA256 de `{t}.{corpo}`), tolerância de 5 min, rotação de segredo com sobreposição, bloqueio de destinos internos (anti-SSRF) |
| API | Rate limit por token, tenant e IP; Form Requests; IDs UUIDv7; `Idempotency-Key` em escritas sensíveis |
| Fórmulas | Parser com lista branca de funções; limite de profundidade e de dependências; sem acesso a nada fora das métricas |
| IA | Só dados agregados; nenhum dado pessoal no prompt; saída validada contra esquema (§7.5) |
| Frontend | CSP estrita, Trusted Types, sanitização do rich text, nenhum token em `localStorage` |
| Uploads | MIME real, limite de tamanho, antivírus (ClamAV), URLs S3 assinadas com expiração |
| Auditoria | `audit_logs` append-only: `delta_app` só tem `INSERT` |
| LGPD | Opt-in do WhatsApp registrado (data, origem, texto aceito); opt-out imediato; retenção configurável; exportação e exclusão de dados do titular; benchmarks entre clientes só anonimizados e com mínimo de amostra; DPA |
| Segredos | Fora do repositório; Vault/Secrets Manager em produção; rotação de `APP_KEY` com `APP_PREVIOUS_KEYS` |
| Dependências | `composer audit`, `npm audit`, Renovate, Trivy, SBOM |
| Headers | HSTS, `frame-ancestors` (liberado só para embed autorizado), Referrer-Policy |
| Backup | PITR (WAL + pgBackRest); restauração testada todo mês |
| Referência | OWASP ASVS nível 2; pentest antes do go-live |

---

## 6. Módulo WhatsApp

### 6.1 Provedor e regras da plataforma

**Recomendação:** Cloud API oficial da Meta, atrás de uma interface `WhatsAppProvider` (drivers: `MetaCloud` padrão; Twilio, 360dialog ou Gupshup como alternativas).

**Não usar APIs não oficiais** (Baileys, Evolution, conexão por QR code): violam os termos do WhatsApp e podem banir o número da agência.

Regras da Meta que moldam o desenho:

- Mensagem iniciada pela empresa fora da janela de 24h exige **template aprovado** (variáveis, cabeçalho de mídia, botões).
- A Meta cobra por mensagem de template, por categoria (utility/marketing) e país. O Delta mede o consumo e limita ou repassa por plano.
- Opt-in do destinatário é obrigatório.
- Envio é 1:1; grupos não são o canal.
- A nota de qualidade do número cai se clientes bloqueiam ou denunciam: opt-out fácil e frequência sensata.

**Número remetente:** fase 1 com número da plataforma Delta; fase 2 com número da própria agência via **Embedded Signup** (Delta como Tech Provider da Meta).

### 6.2 O que o usuário configura (tela "Envio automático")

| Opção | Valores |
|---|---|
| Destinatários | Contatos do projeto com WhatsApp verificado e opt-in |
| Frequência | Diária, semanal, quinzenal, mensal, personalizada; ou por evento: meta batida, alerta crítico, fim de campanha |
| Dia e hora | No fuso do cliente; "horário inteligente" evita madrugada e fim de semana |
| Período | Últimos 7/14/30 dias, mês anterior, mês até hoje, personalizado; comparação com período anterior ou ano anterior |
| Formato | (a) resumo em texto; (b) cartão visual PNG com KPIs e mini-gráficos; (c) PDF anexo; (d) link do relatório interativo. Combináveis |
| Conteúdo | Métricas e indicadores personalizados por arrastar e soltar; tendência ▲▼; semáforo de atenção; sugestão da semana (opcional) |
| Mensagem | Texto com variáveis (`{{cliente}}`, `{{periodo}}`, `{{kpi.roas}}`...) e preview ao vivo idêntico ao WhatsApp |
| Aprovação | Automática ou "revisar antes de enviar" (aprovação em 1 toque, prazo e ação padrão) |
| Canais | WhatsApp, e-mail ou ambos; e-mail como fallback |
| Interação | Botões "Ver relatório completo", "Falar com a agência", "Parar de receber"; palavra-chave "relatório" devolve o último na hora (dentro da janela de 24h) |
| Acompanhamento | Status por mensagem (enviada, entregue, lida, falhou); reenvio manual |

Também via WhatsApp: alertas internos para a agência (atenção crítica, conexão expirada) e aprovação de posts pelo cliente (Publishing).

### 6.3 Fluxo técnico

```
Scheduler (a cada minuto) ─▶ automações vencidas
  └▶ BuildSnapshot (render): busca métricas, calcula indicadores e semáforo, congela
       └▶ RenderAssets: PNG do cartão + PDF via Gotenberg → S3
            └▶ INSERT em message_outbox na mesma transação
               (idempotência = automation_id + período + destinatário)
                 └▶ DispatchOutbox (whatsapp, throttle por número)
                      └▶ Cloud API ─▶ webhook de status ─▶ messages.status ─▶ Reverb

Falha: 3 tentativas com backoff ─▶ DLQ ─▶ alerta à agência + fallback por e-mail
```

### 6.4 Templates na Meta

- Templates base em pt-BR, es e en: `relatorio_periodico`, `resumo_kpis`, `alerta_meta`, `aprovacao_post`.
- Submissão e status de aprovação gerenciados pelo próprio Delta; o usuário nunca abre o painel da Meta.

```
📊 *Relatório semanal — Padaria Aurora*
05/11 a 11/11 · comparado à semana anterior

💰 Investimento: R$ 1.240   ▲ 8%
🛒 Conversões: 132          ▲ 15%
🎯 CPA: R$ 9,39             ▼ 6%   🟢
📈 ROAS: 4,1                ▲ 12%  🟢
🔁 Frequência: 3,6                 🟡 atenção

💡 Os anúncios estão sendo vistos muitas vezes pelas mesmas
   pessoas. Vamos renovar os criativos nesta semana.

[ Ver relatório completo ]  [ Falar com a agência ]
```

---

## 7. Inteligência de marketing (funcionalidades novas)

Três peças que se alimentam: **indicadores personalizados** definem o que medir; o **semáforo de atenção** diz o que está fora do esperado; as **sugestões de melhoria** dizem o que fazer e medem se funcionou.

```
 métricas sincronizadas ─▶ indicadores personalizados ─▶ motor de atenção ─▶ sugestões
          ▲                                                    │                │
          └──────── medição de impacto ◀── plano de ação ◀─────┴────────────────┘
```

### 7.1 Indicadores personalizados

| Aspecto | Definição |
|---|---|
| Criação | Editor visual (chips de métricas + operadores) ou modo texto com autocompletar; preview com dados reais do projeto enquanto digita |
| Exemplo | `ROAS combinado = SAFE_DIV([shopify:revenue], [meta_ads:spend] + [google_ads:cost])` |
| Cruzamento | Combina métricas de plataformas diferentes (Shopify + Meta + Google, CRM + Ads) |
| Fontes extras | Valores manuais (vendas offline, margem, meta) e planilhas |
| Funções | `SUM`, `AVG`, `MIN`, `MAX`, `ABS`, `ROUND`, `IF`, `SAFE_DIV`, `PREV(x)` (período anterior), `GROWTH(x)` |
| Propriedades | Nome, descrição, formato (número, moeda, %, tempo), casas decimais, direção ("maior é melhor" / "menor é melhor"), faixas de atenção |
| Escopo | Biblioteca da agência (reutilizável em todos os projetos) ou só de um projeto |
| Uso | Em relatórios, dashboards, metas, automações de WhatsApp, API e MCP, igual a uma métrica nativa |
| Biblioteca pronta | ROAS combinado (MER), CAC, CPL, LTV/CAC, ROI, ticket médio, custo por seguidor, engajamento por alcance, conversão do funil (lead → venda) |

**Regra de cálculo que evita o erro mais comum:** a fórmula é avaliada sobre os componentes agregados do período (razão das somas), nunca pela média das razões diárias. CPA do mês = gasto do mês ÷ conversões do mês.

**Implementação:** parser próprio que gera uma AST guardada em JSONB, com lista de dependências; indicadores podem usar outros indicadores (grafo com detecção de ciclo); divisão por zero vira vazio, não erro; nada de `eval`.

### 7.2 Semáforo de atenção

Cada indicador recebe um estado: 🟢 saudável · 🟡 atenção · 🔴 crítico · 🔵 oportunidade. Sempre com o **porquê** ("Frequência 3,6 nos últimos 7 dias; acima de 3 o público tende a saturar") e o **o que fazer**.

Quatro detectores:

| Detector | Pergunta | Exemplo |
|---|---|---|
| Boas práticas | Está fora da faixa recomendada? | Frequência > 3 em 7 dias |
| Histórico do cliente | Está fora do normal *para este cliente*? (sazonalidade semanal, desvio robusto) | CPM 35% acima da média das últimas 4 semanas |
| Meta do projeto | Está no ritmo da meta? | Projeção do mês indica 70% da meta de leads |
| Qualidade dos dados | O número é confiável? | Conversões zeraram de um dia para o outro: provável tag quebrada |

Proteções contra ruído:

- **Volume mínimo:** não acusa CTR baixo com 200 impressões.
- **Persistência:** precisa se manter por N dias antes de virar alerta.
- **Cooldown e agrupamento:** o mesmo alerta não se repete; vários sintomas da mesma causa viram um só.
- **Ajuste por agência:** cada agência pode editar faixas, desligar regras e definir faixas por nicho.
- **Contexto do negócio:** o projeto informa nicho, margem bruta e ticket médio. Ex.: ROAS de equilíbrio = 1 ÷ margem bruta.

Ciclo de vida do alerta: aberto → reconhecido → em ação → resolvido (fecha sozinho quando o indicador volta ao normal) ou descartado (com motivo, que realimenta o ajuste das regras).

**Onde aparece:** selo no widget do relatório e do dashboard (pulso suave), painel "Radar" do projeto, Overview com a saúde de cada conta, alerta para a agência por WhatsApp/e-mail e, se a agência quiser, seção "Próximos passos" no relatório do cliente.

### 7.3 Catálogo inicial de regras

Valores padrão de partida, **editáveis e a validar com um especialista de mídia antes do lançamento**.

| Canal | Indicador | Condição padrão | Estado | Sugestão |
|---|---|---|---|---|
| Meta Ads | Frequência (público frio) | > 3 em 7 dias (> 4 crítico) | 🟡/🔴 | Renovar criativos, ampliar público, excluir quem já converteu |
| Meta Ads | CTR de link | Abaixo da faixa do nicho ou −30% vs histórico | 🟡 | Testar novos ganchos nos primeiros segundos; revisar oferta e público |
| Meta Ads | CPM | +30% vs média de 4 semanas | 🟡 | Checar sazonalidade e sobreposição de públicos |
| Meta Ads | Fase de aprendizado | Conjuntos em "aprendizado limitado" | 🟡 | Consolidar conjuntos para concentrar conversões |
| Meta/Google | CPA | > meta do projeto em 20% | 🔴 | Mover verba para conjuntos/campanhas abaixo da meta |
| Meta/Google | ROAS | < ROAS de equilíbrio (1 ÷ margem) | 🔴 | Pausar o que dá prejuízo; revisar oferta e público |
| Meta/Google | Entrega do orçamento | < 80% do planejado | 🟡 | Revisar lances e restrições de público |
| Google Ads | Impressões perdidas por orçamento | > 20% em campanhas com CPA abaixo da meta | 🔵 | Aumentar orçamento dessas campanhas |
| Google Ads | Índice de qualidade | < 5 em palavras com gasto relevante | 🟡 | Melhorar relevância do anúncio e da página de destino |
| Google Ads | Termos de pesquisa | Termos com gasto e zero conversão | 🟡 | Negativar termos |
| GA4 | Conversões | Zeraram ou caíram > 50% sem queda de tráfego | 🔴 | Verificar tag, GTM e consent mode |
| GA4 | Tráfego sem origem | Fatia alta de direto/(not set) | 🟡 | Padronizar UTMs (gerador de UTM do Delta) |
| GA4 | Conversão no celular | < metade da do computador | 🟡 | Revisar experiência e velocidade no celular |
| Instagram | Engajamento por alcance | Abaixo do histórico ou da faixa do nicho | 🟡 | Revisar formatos e temas com melhor desempenho |
| Instagram | Ritmo de publicação | < 3 posts por semana | 🟡 | Montar calendário no Publishing |
| Instagram | Mix de formatos | Reels com alcance 2× maior mas < 30% dos posts | 🔵 | Aumentar a proporção de Reels |
| Search Console | CTR no top 3 | Abaixo da curva de CTR do próprio site | 🔵 | Reescrever title e meta description |
| Search Console | Posições 8 a 20 | Consultas com muitas impressões | 🔵 | Reforçar conteúdo e links internos |
| Google Meu Negócio | Avaliações | Sem resposta há mais de 48h | 🟡 | Responder (rascunho sugerido pela IA) |
| Google Meu Negócio | Nota média | Queda no mês | 🟡 | Investigar avaliações negativas recentes |
| E-commerce | Abandono de carrinho | Acima da faixa do nicho | 🟡 | Recuperação por e-mail/WhatsApp; revisar frete e checkout |
| E-commerce | Taxa de conversão | Abaixo da faixa do nicho ou −20% vs histórico | 🟡 | Revisar página de produto, preço e prova social |
| CRM | Tempo de 1ª resposta ao lead | Acima do combinado (ex.: 1h em horário comercial) | 🟡 | Automação de primeira resposta |
| Geral | Conexão | Token expirado ou sincronização falhando | 🔴 | Reconectar (link direto) |
| Geral | Indicador personalizado | Fora da faixa definida pela agência | conforme faixa | Texto definido pela agência |

**Regras como dados:** cada regra é JSON versionado (métrica, janela, escopo, condição, volume mínimo, persistência, estado, playbook), avaliado depois de cada sincronização. Regras complexas podem ser escritas em código com a mesma interface. Cada regra tem testes com fixtures.

**Benchmarks:** faixas por plataforma, métrica e nicho (p25/p50/p75), com fonte e data. Começam com valores curados; depois passam a usar também agregados anônimos da própria base (só com amostra mínima e consentimento).

### 7.4 Sugestões de melhoria e plano de ação

| Etapa | Como funciona |
|---|---|
| Sugestão base | Cada regra tem um *playbook* curado por especialista: o que fazer, por quê, esforço estimado |
| Personalização por IA | A IA recebe os fatos calculados (qual conjunto, qual criativo, quais números) e escreve a sugestão específica do caso |
| Priorização | Ordem por severidade × dinheiro envolvido × esforço |
| Plano de ação | Sugestões viram tarefas (kanban do Publishing), com responsável e prazo |
| Aprovação | A agência revisa antes de qualquer sugestão chegar ao cliente |
| Medição | Ao marcar "aplicada", o Delta compara o indicador antes e depois (ex.: 14 dias) e mostra o resultado; o marco entra na Linha do Tempo |
| Aprendizado | "Útil / não útil" e resultados medidos mostram quais playbooks funcionam |

### 7.5 Saúde da conta e guardrails de IA

**Saúde da conta (0–100):** combina alertas abertos (peso por severidade) e ritmo das metas. Aparece em três anéis animados (Aquisição, Engajamento, Conversão) no projeto e como ranking no Radar da Overview: a agência abre o dia sabendo quais clientes precisam de atenção.

**Guardrails de IA:**

- O modelo recebe só um JSON de fatos calculados pelo sistema, com IDs.
- A resposta segue um esquema JSON; cada número citado precisa corresponder a um fato. Um validador rejeita números que não estão nos fatos.
- Nenhum dado pessoal (nomes de leads, e-mails, telefones) vai para o modelo.
- Texto de IA sempre marcado como sugestão e revisável antes de chegar ao cliente.
- Orçamento de tokens por tenant e por plano.

---

## 8. Modelo de dados (núcleo)

Convenções: PK `uuid` com `uuidv7()`; `tenant_id` em toda tabela de negócio; `timestamptz`; JSONB para layouts, ASTs e evidências; soft delete só onde há restauração.

| Grupo | Tabelas |
|---|---|
| Tenancy | `tenants`, `users`, `tenant_user`, `invitations`, `branding` |
| Projetos | `projects` (nicho, margem, ticket médio), `project_members`, `contacts`, `contact_consents` |
| Integrações | `providers` (global), `connections`, `integration_accounts`, `project_accounts` |
| Métricas | catálogo versionado no código (ADR 0005), `metric_facts_daily` (particionada por mês), `metric_period_values`, `manual_metric_values` |
| Inteligência | `custom_metrics` (AST, dependências, faixas), `insight_rules` (globais, versionadas), `rule_overrides` (por tenant/nicho), `benchmarks` (global), `insights` (estado, evidências), `recommendations`, `recommendation_outcomes`, `health_scores_daily` |
| Relatórios | `report_templates`, `reports` (layout JSONB), `report_snapshots`, `share_links` |
| Dashboards | `dashboards`, `dashboard_widgets` |
| Automações | `automations`, `automation_recipients`, `automation_runs` |
| Mensageria | `whatsapp_numbers`, `whatsapp_templates`, `message_outbox`, `messages`, `message_events`, `inbound_messages` |
| Metas e timeline | `goals`, `goal_alerts`, `timeline_events` |
| IA e Studio | `ai_insights`, `presentations`, `presentation_versions` |
| Publishing | `content_calendars`, `posts`, `post_targets` (por rede), `approvals`, `tasks` |
| Anúncios e mídia | `ad_objects`, `ad_operations`, `media_assets`, `media_uploads` |
| Sync | `sheet_syncs`, `sheet_sync_runs` |
| Plataforma | `api_tokens` (Passport), `webhook_endpoints`, `webhook_deliveries`, `outbox_events` |
| Connect | `connect_customers` (token como hash), `connect_sessions`, `toolkit_connections`, `tool_executions`, `llm_credentials` |
| Auditoria | `audit_logs`, `webhook_receipts` |

**Métricas não aditivas:** alcance, usuários únicos e frequência **não podem ser somados dia a dia**. São consultados na API para o período exato e guardados em `metric_period_cache`. Errar isso gera números diferentes dos que o cliente vê no Meta/Google. Métricas aditivas (gasto, cliques, conversões) ficam em `metric_facts_daily`. Respostas brutas das APIs ficam 30 dias no S3 para reprocessamento.

---

## 9. Integrações

### 9.1 Framework de conectores

```php
interface Connector
{
    public function provider(): string;                        // 'meta_ads'
    public function authorizeUrl(Tenant $tenant): string;
    public function handleCallback(Request $request): Connection;
    public function refresh(Connection $connection): void;
    public function discoverAccounts(Connection $connection): iterable;
    /** @return MetricDefinition[] */
    public function catalog(): array;
    public function fetch(MetricQuery $query): MetricResult;
}

interface Publisher   { public function publish(Post $post): PublishResult; }   // Publishing
interface AdsManager  { /* campanhas, conjuntos, anúncios, boost, validate */ }  // Ads
```

- `MetricDefinition` usa o mesmo vocabulário do mercado: `reference_key` (`plataforma:métrica`), componente (número, gráfico, tabela), dimensões e entidade. Isso facilita o importador e a API.
- Um conector Saloon por provedor, com rate limiter, backoff e circuit breaker.
- Sincronização: backfill de 13 meses ao conectar; incremental diário escalonado; sob demanda ao abrir relatório, com cache.
- Saúde da conexão: token expirando ou revogado gera alerta (🔴 no semáforo), e-mail e link direto para reconectar.
- Testes com fixtures gravadas; o CI nunca chama API real.

### 9.2 Caminho crítico: aprovações externas (começar na semana 1)

Podem levar semanas e não dependem de código.

| Provedor | O que é preciso |
|---|---|
| Meta (Facebook, Instagram, Ads, WhatsApp, Threads) | Business Verification + App Review (`ads_read`, `ads_management`, `pages_read_engagement`, `pages_manage_posts`, `instagram_manage_insights`, `instagram_content_publish`, `business_management`, `whatsapp_business_messaging`...) e cadastro como Tech Provider |
| Google Ads | Developer token com acesso Basic |
| Google (GA4, Search Console, Meu Negócio, Sheets, YouTube) | Tela de consentimento OAuth verificada; Business Profile API exige pedido de acesso |
| LinkedIn | Acesso à Marketing e Community Management API (aprovação restrita) |
| TikTok | App review no TikTok for Business Developers |
| Pinterest, X, Microsoft Ads | Acesso de desenvolvedor de cada plataforma |

### 9.3 Construir ou comprar

| Item | Recomendação |
|---|---|
| Conectores de métricas (53) | Próprios, começando pelos 5 da fase 1. A interface `Connector` permite um driver de agregador para a cauda longa, se compensar |
| Toolkits do Connect (~100 apps, ~1.184 tools) | Não construir um a um. Avaliar parceria com uma plataforma de integrações de ferramentas, ou lançar com as 10 mais pedidas (Slack, Gmail, Google Calendar, Notion, Jira, Trello, Teams, Drive, HubSpot, WhatsApp) |
| Gateway de LLM | Próprio e simples (compatível com o SDK da OpenAI, chave do cliente, fallback); avaliar base open source |

Reportei Connect, Windsor.ai e Supermetrics API cobrem muitas plataformas rapidamente, mas cobram por conexão e criam dependência. O Reportei Connect, além disso, é o próprio concorrente.

---

## 10. API pública, webhooks, MCP e CLI do Delta

### 10.1 API REST v1

Paridade com a API v2 do Reportei, mais os recursos que ela não tem. OpenAPI gerado do código.

| Recurso | Paridade | Novo no Delta |
|---|---|---|
| `GET /company/settings` (com limites) | ✔ | — |
| `projects` | ✔ (leitura) | Criar/editar; contatos; perfil de negócio |
| `integrations`, `metrics`, `POST /metrics/get-data` | ✔ | Inclui indicadores personalizados no mesmo endpoint |
| `templates`, `reports`, `dashboards` | ✔ | Snapshots e links públicos |
| `timeline-events` | ✔ | — |
| `webhooks` (+ `events`) | ✔ | Histórico de entregas, reenvio, teste, rotação de segredo |
| `goals`, `automations` | Só via MCP no Reportei | CRUD na API |
| `custom-metrics`, `insights`, `recommendations`, `health` | — | ✔ |
| `messages` (WhatsApp) | — | Status e reenvio |

- Auth: tokens pessoais com escopos (Passport) e OAuth para apps de terceiros.
- Limites por token e por funcionalidade; headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`.
- Paginação: `page`, `per_page` (máx. 100), `sort`, `q`; respostas em `data` + `meta`; erros em `error` (`code`, `message`, `details`).

**Eventos de webhook:** paridade (`report.viewed`, `report.created`, `dashboard.created`, `automation.executed`, `goal.met`, `goal.not_met`, `timeline.milestone_added`) + novos (`insight.opened`, `insight.resolved`, `recommendation.applied`, `message.delivered`, `message.read`, `message.failed`, `connection.expired`, `post.published`, `post.failed`).

### 10.2 Servidor MCP

- `laravel/mcp`, Streamable HTTP, OAuth 2.1 + PKCE com registro dinâmico de cliente; token Bearer como alternativa.
- **Paridade com as 38 tools** do Reportei (§1.3).
- **Novas tools:** `list_insights`, `get_project_health`, `get_recommendations`, `mark_recommendation_applied`, `create_custom_metric`, `explain_metric`, `send_report_whatsapp` (exige confirmação), `schedule_post`.
- **Prompts:** paridade (`marketing-review`, `social-audit`, `campaign-analysis`, `seo-check`, `monthly-report`) + `account-health`, `weekly-action-plan`.

### 10.3 CLI (`delta`)

TypeScript/Node no npm, cliente do servidor MCP (mesma estratégia do Reportei). Device Flow, perfis, saída em tabela/JSON/CSV, REPL. Comandos em paridade com `@reportei/cli` (§1.4), mais `insights`, `health`, `recommendations` e `custom-metrics`.

### 10.4 Delta Connect (fase 4)

Paridade com o Reportei Connect (§1.5): merchants, customers com token exibido uma única vez, sessão hospedada de conexão (com a marca do merchant), métricas síncronas e assíncronas, anúncios Meta, mídia multipart, posts em 6 redes, toolkits, gateway de LLM e webhooks assinados. É o núcleo de dados das fases 1–3 exposto para outros SaaS, com o merchant como tenant.

### 10.5 Importador do Reportei

O usuário cola o token da API v2 do Reportei dele e o Delta importa projetos, templates, linha do tempo e lista de integrações (para reconectar em 1 clique). Reduz o custo de troca. Respeita os limites da API v2.

---

## 11. Publishing (Flux) e Studio

**Publishing:** calendário editorial por projeto; posts para Instagram (feed, carrossel, reels, story), Facebook, Threads, LinkedIn, Pinterest e YouTube Shorts; biblioteca de mídia; aprovação do cliente por link ou WhatsApp (botões "Aprovar" / "Pedir ajuste"); kanban de tarefas, que também recebe as sugestões do §7.4.

**Studio:** descrição em linguagem natural → apresentação (página única ou slides) com os dados do projeto, no design system do Delta; ajustes por chat; exportação em PDF e link; mesmos guardrails de IA (§7.5).

---

## 12. Frontend e design system

### 12.1 Linguagem visual inspirada no Apple HIG

Inspirado, não copiado: SF Pro e SF Symbols têm licença restrita a plataformas Apple, e marcas Apple não podem ser usadas.

- **Tipografia:** pilha de fontes do sistema (`-apple-system, BlinkMacSystemFont, ...`), que exibe a fonte nativa em aparelhos Apple de forma legítima, com Inter nos demais. Escala no estilo HIG: Large Title 34, Title 28/22/20, Headline 17 semibold, Body 17, Callout 16, Subhead 15, Footnote 13, Caption 12.
- **Ícones:** Lucide ou Phosphor, traço fino.
- **Materiais:** direção **Liquid Glass**. A camada de navegação e controles é de vidro e flutua sobre o conteúdo: fundo translúcido, desfoque e saturação do que está atrás (`backdrop-filter`), brilho especular na borda de cima, sombra na de baixo e um reflexo diagonal suave. Quatro variações em `base.css`: `.ds-glass` (regular), `.ds-glass-strong` (menus e avisos), `.ds-glass-clear` (controles sobre outro vidro) e `.ds-glass-tinted` (cor de destaque). Com "reduzir transparência" no sistema, o vidro vira superfície opaca.
- **Formas:** cantos concêntricos 10/14/20/28; botões e itens de navegação em cápsula.
- **Cor:** neutros + 1 cor de destaque configurável (vira a cor da agência no white label); cores semânticas do semáforo; modo escuro de primeira classe; contraste AA.
- **Espaçamento:** base 4/8.
- **Movimento:** física de mola em vez de easing linear; 150 a 450 ms.

Tudo vira token (CSS custom properties) em `design-system/tokens`, consumido pelo Tailwind v4 e documentado no Storybook.

### 12.2 Animações futuristas, com propósito

| Onde | Efeito |
|---|---|
| Navegação | View Transitions API: o card do relatório se transforma na página |
| KPIs e gráficos | Contagem animada; gráficos que se desenham na entrada |
| Saúde da conta | Anéis que se completam ao abrir o projeto |
| Semáforo | Pulso suave no selo de atenção; ao abrir, o painel explica o porquê |
| Editor de fórmulas | Chips de métricas que encaixam com mola; resultado ao vivo |
| Login e Overview | Gradient mesh ambiente, sutil |
| Cards de vidro | Brilho que segue o cursor; inclinação 3D leve |
| Conectar integração | "Handshake" animado com progresso real via WebSocket |
| Envio no WhatsApp | Mensagem que "voa" do preview para o status "entregue" em tempo real |
| Carregamento | Skeletons com shimmer |
| Comandos | Paleta ⌘K com blur |

Regras: animar só `transform` e `opacity`; 60 fps; `prefers-reduced-motion` desliga o que não é essencial; LCP < 2 s e INP < 200 ms.

Tecnologia: CSS nativo + `animate.enter`/`animate.leave` do Angular (o pacote `@angular/animations` foi depreciado), GSAP (gratuito desde 2025) para sequências complexas, ECharts para gráficos.

### 12.3 Facilidade extrema de uso

- **Onboarding em 3 passos:** conectar conta → escolher modelo → agendar WhatsApp. Meta: primeiro envio em menos de 5 minutos.
- **Padrões inteligentes:** ao conectar o Meta Ads, o sistema propõe relatório mensal, automação e regras de atenção já ligadas.
- **Perfil do negócio em 30 segundos:** nicho, margem e ticket médio, que calibram o semáforo.
- **Modelos por nicho:** e-commerce, infoproduto, negócio local, B2B, restaurante/delivery.
- **Builder** de arrastar e soltar, preview ao vivo, salvamento automático, desfazer.
- **⌘K para tudo** e atalhos de teclado.
- **Estados vazios que ensinam;** glossário de métricas em tooltip.
- **PWA mobile-first** para aprovar envios, posts e sugestões no celular.
- **Idiomas:** pt-BR primeiro; es e en depois.

### 12.4 Arquitetura Angular

- Standalone, Signals, zoneless, NgRx SignalStore, rotas lazy por funcionalidade.
- `projects/design-system`: tokens, componentes, Storybook. Base em Angular CDK; sem Angular Material (visual Material conflita com o HIG).
- `projects/app/features`: overview, projects, reports, dashboards, insights, automations, publishing, studio, integrations, settings, developer (tokens, webhooks, logs).
- SSR só na rota pública `/r/:token` (carregamento rápido + Open Graph para prévia no WhatsApp).
- Rota `/print/:snapshot` usada pelo Gotenberg: PDF idêntico à tela.

---

## 13. Estrutura do repositório

```
delta/
├── backend/                 # Laravel
│   └── app/Domain/{Tenancy,Projects,Integrations,Metrics,Insights,Reports,
│                   Dashboards,Automations,Messaging,Goals,Timeline,AI,Studio,
│                   Publishing,Ads,Media,Sync,PublicApi,Webhooks,Mcp,Connect,
│                   Importer,Billing,Audit}
├── frontend/                # workspace Angular
│   ├── projects/app
│   └── projects/design-system
├── cli/                     # delta CLI (TypeScript)
├── infra/
│   ├── docker/php/          # imagem PHP (FrankenPHP + extensões + Composer)
│   └── db/init/             # roles e bancos do Postgres
├── bin/                     # compose (com fallback sem plugin), setup-env
├── compose.yaml             # api, horizon, scheduler, postgres, valkey, mailpit (+ gotenberg, minio, reverb nas próximas fases)
├── Makefile                 # make help
└── docs/
    ├── PLANEJAMENTO.md
    └── adr/
```

---

## 14. Roadmap por fases

| Fase | Entregas |
|---|---|
| **0 — Fundação** | Monorepo e Docker; roles do Postgres, RLS e testes de isolamento no CI; auth (Sanctum, 2FA, passkeys); tenancy e convites; auditoria; outbox; tokens do design system + ~20 componentes no Storybook; CI (lint, testes, SAST, Trivy). **Em paralelo: pedidos de aprovação Meta e Google.** |
| **1 — MVP** | Projetos, contatos com opt-in e perfil do negócio; conectores Meta Ads, Facebook, Instagram, Google Ads, GA4 + fonte manual; catálogo de métricas; **indicadores personalizados**; **semáforo de atenção** (regras de boas práticas, metas simples e qualidade de dados para os 5 canais) com **sugestões base**; builder com 6 modelos; snapshot, link público, PDF; automação por e-mail e WhatsApp (número da plataforma, templates, status, aprovação antes de enviar); Overview |
| **2 — Crescimento** | Dashboards ao vivo; Controle (metas e alertas); Linha do tempo; copiloto de IA e sugestões personalizadas por IA; detector de histórico (anomalias); benchmarks por nicho; saúde da conta e Radar; plano de ação com medição de impacto; +15 conectores; white label; número da agência via Embedded Signup; portal do cliente; caixa de respostas do WhatsApp; **API pública v1 + webhooks**; importador do Reportei |
| **3 — Plataforma** | Publishing (calendário, posts em 6 redes, aprovação via WhatsApp, tarefas); gestão de Meta Ads; Studio; Sync para Google Sheets; **servidor MCP + CLI**; restante das 53 integrações |
| **4 — Ecossistema** | **Delta Connect** (customers, sessão hospedada, métricas assíncronas, posts, anúncios, mídia, toolkits, gateway de LLM, webhooks); billing completo; site de marketing com Academy, ferramentas gratuitas e programa de afiliados |

---

## 15. Decisões em aberto

| # | Decisão | Recomendação |
|---|---|---|
| 1 | Público: agências, empresas finais ou ambos? | Agência = tenant; projeto = cliente final. Empresa final é uma "agência" com 1 projeto |
| 2 | Número do WhatsApp na fase 1 | Número da plataforma; número da agência na fase 2 |
| 3 | Conectores de métricas | Próprios, começando pelos 5 da fase 1 |
| 4 | Toolkits do Connect | Parceria com plataforma de integrações, ou só os 10 mais pedidos |
| 5 | Quem valida o catálogo de regras e benchmarks | Especialista de mídia/performance antes do lançamento da fase 1 |
| 6 | Hospedagem | A definir (AWS, GCP, Hetzner + Postgres gerenciado, Laravel Cloud) |
| 7 | Nome da marca e domínio | "Delta" é provisório |
| 8 | Cobrança de WhatsApp e IA | Franquia por plano + pacote adicional |

---

## 16. Andamento

### Fase 0 — Fundação (iniciada em 12/11/2026)

| Item | Estado |
|---|---|
| Ambiente local em containers (`compose.yaml`, `bin/compose`, `Makefile`), só git local | ✅ |
| Postgres 18 com roles `delta_owner` / `delta_app` / `delta_admin` / `delta_readonly` | ✅ |
| RLS fail-closed: `tenants`, `users`, `tenant_user`, `projects`, `project_members`, `audit_logs`; política restritiva do papel cliente | ✅ |
| `TenantContext`, middlewares (`ResetDatabaseContext`, `tenant`), limpeza no Octane e nas filas, reaplicação na reconexão | ✅ |
| Autenticação sob RLS (provider próprio + funções `SECURITY DEFINER`), cadastro cria agência, login, 2FA TOTP, CSRF | ✅ |
| Auditoria append-only | ✅ |
| Testes: cobertura de RLS, isolamento entre agências, contexto entre requests, auth, API de projetos (37 testes) | ✅ |
| PHPStan nível máximo + Pint | ✅ |
| Frontend Angular 22: design system (tokens HIG, 9 componentes), login/cadastro/2FA, shell, Overview (mock), Projetos, vitrine | ✅ |
| Fluxo ponta a ponta SPA → proxy → API verificado | ✅ |
| Passkeys sob RLS: busca da credencial por função estreita, contexto só após a assinatura, contador travado (ADR 0025) | ✅ |
| Storybook | ⏳ (vitrine `/design-system` no lugar) |
| Pedidos de aprovação Meta e Google | ⏳ depende de você (contas de desenvolvedor) |
| Convites de usuários para a agência, seleção de papel: tela Equipe, convite por e-mail com link de uso único, aceite com criação de conta, regras de dono, RLS restritivo (ADR 0010) | ✅ |
| Observabilidade (OpenTelemetry/Sentry), Trivy/SBOM | ⏳ |

### Fase 1 — MVP (iniciada em 12/11/2026)

| Item | Estado |
|---|---|
| Catálogo de 50 métricas em 5 canais (Meta Ads, Google Ads, GA4, Instagram, Facebook), versionado no código | ✅ (ADR 0005) |
| Motor de fórmulas seguro (base dos indicadores personalizados) | ✅ |
| Conexões, contas e vínculo conta ↔ projeto, com RLS | ✅ |
| Modo demonstração: dados realistas e determinísticos enquanto as aprovações não saem | ✅ |
| `metric_facts_daily` particionada por mês (partições sem acesso direto da aplicação) + cache de métricas não aditivas | ✅ |
| Sincronização em fila (Horizon), idempotente, com histórico de 400 dias | ✅ |
| Consulta unificada: agregação correta por tipo, comparação (período anterior / ano anterior), séries diárias | ✅ |
| Telas de Integrações e de Projeto (KPIs clicáveis, gráfico SVG próprio com comparação, seletor de período) | ✅ |
| Indicadores personalizados: API, funções no motor, validação de ciclos, preview ao vivo, 8 modelos, editor com autocompletar (ADR 0006) | ✅ |
| Semáforo de atenção: 15 regras, metas do projeto, 3 janelas, sugestões curadas, Radar no projeto e selos nos KPIs (ADR 0007) | ✅ |
| Conexão em um clique: login da plataforma em pop-up (OAuth com state de uso único, PKCE, 3 canais de retorno), modo demonstração com a mesma jornada, login real Meta e Google pronto para credenciais (ADR 0008) | ✅ |
| Apps das plataformas configurados pela agência: dono/admin cadastra as credenciais OAuth da Meta e do Google na tela, com verificação na própria plataforma, segredos criptografados e RLS restritivo de escrita (ADR 0009) | ✅ |
| Relatórios: montador com 5 tipos de bloco, 6 modelos por nicho, prévia ao vivo, versão publicada imutável (privilégio por coluna), link público com senha/validade, PDF pelo Gotenberg (ADR 0011) | ✅ |
| Contatos com consentimento rastreável e descadastro em um clique; envios automáticos por e-mail (PDF anexo) e WhatsApp (Cloud API oficial ou demonstração), agenda no fuso da agência, aprovação antes de enviar, status por mensagem, webhook assinado e "PARAR" (ADR 0012, 0013) | ✅ |
| Sincronização diária automática de todas as agências, com listagem entre agências só de ids (ADR 0012) | ✅ |
| Coletores reais de Meta Ads, Facebook, Instagram, GA4 e Google Ads, com renovação de token (lock), expiração e erros traduzidos (ADR 0014); validação com contas reais depende das aprovações | ✅ |
| Fonte manual de dados: métricas da agência lançadas por projeto e dia, importação de planilha pt-BR, uso em relatórios e indicadores (ADR 0015) | ✅ |
| Visão geral real: KPIs combinados, saúde por etapa do funil, Radar e estado dos projetos, com cache por escopo | ✅ |
| Ambiente local pronto para uso: `make dev` + `make demo` (agência de demonstração com dados) | ✅ |

### Fase 2 — Crescimento (iniciada em 12/11/2026)

| Item | Estado |
|---|---|
| Dashboard ao vivo: link público recalculado com cache curto e modo TV (ADR 0016) | ✅ |
| Metas por projeto com ritmo, projeção e alertas à equipe; linha do tempo com marcos manuais e automáticos (ADR 0017) | ✅ |
| Observabilidade: id de requisição propagado a logs e jobs, contexto da agência nos logs, canal JSON, `/api/health` | ✅ |
| Detectores de histórico do cliente e de qualidade dos dados, referências por nicho, saúde da conta (0–100) com tendência, plano de ação com medição de impacto (ADR 0018) | ✅ |
| White label: nome, cor, logo recodificado, selo, resposta dos e-mails, domínio próprio com verificação de DNS; aplicado a PDF, link público e e-mails (ADR 0019) | ✅ |
| API pública v1 (tokens por agência com escopos, limite por token) e webhooks assinados com novas tentativas e anti-SSRF; documentação em docs/api-v1.md (ADR 0020) | ✅ |
| Copiloto de IA (Claude): análise do relatório e perguntas sobre o projeto, chave por agência, só fatos calculados, validador de números, orçamento mensal (ADR 0021) | ✅ |
| Importador do Reportei: projetos, marcos e checklist de contas para reconectar; token só criptografado na fila (ADR 0022) | ✅ |
| Caixa de respostas do WhatsApp: conversas com o cliente final, resposta dentro da janela de 24 h, simulação no modo demonstração (ADR 0023) | ✅ |
| Canais novos: Search Console, YouTube, Perfil da Empresa no Google, TikTok Ads e LinkedIn Ads, com login, coletor real, demonstração e seção nos relatórios (ADR 0024); validação com contas reais depende das aprovações | ✅ |
| Fonte manual de dados; coletores reais; ambiente local com demonstração | ✅ (ver Fase 1) |
| Publishing (1ª fatia): biblioteca de mídia (recodificada), posts por projeto com destinos e regras por rede/formato, aprovação do cliente por link (e-mail/WhatsApp), agendamento e publicação idempotente; Instagram e Facebook reais (após App Review) e demonstração (ADR 0028) | ✅ (adiantado da Fase 3) |
| Studio: apresentações (slides ou página única) geradas por IA a partir de uma descrição; a IA escolhe métricas de um cardápio fechado e o Delta calcula os números; ajustes por chat em versões; PDF 16:9 com a marca (ADR 0029) | ✅ (adiantado da Fase 3) |
| Gestão de Meta Ads: campanhas e conjuntos com investimento de 7 dias; pausar, ativar e mudar orçamento diário com trava acima de 50%, idempotência, registro e marco na linha do tempo; demonstração persistente (ADR 0030) | ✅ (adiantado da Fase 3) |
| Sync: exportação agendada (diária/semanal) das métricas para Google Sheets, escopo `drive.file`, destino pelo mesmo login em pop-up, prévia em demonstração (ADR 0027) | ✅ (adiantado da Fase 3) |
| Servidor MCP (Streamable HTTP em /mcp) com token da API e escopo `mcp:tools`, 9 ferramentas de leitura e 2 prompts; CLI `delta` (Node, sem dependências) sobre o MCP (ADR 0026); OAuth 2.1/Device Flow pendentes | ✅ (adiantado da Fase 3) |

### Fase 4 — Ecossistema (iniciada em 12/11/2026)

| Item | Estado |
|---|---|
| Billing: planos Essencial/Pro/Agência com limites, franquias de WhatsApp e IA, recursos por plano, teste grátis de 14 dias, 402 em pt-BR; troca de plano só pelo sistema (RLS) (ADR 0031) | ✅ núcleo; provedor de pagamento e preços pendentes |
| Delta Connect (1ª fatia): customers com token próprio, isolamento por projeto no banco (política RESTRICTIVE em toda tabela com project_id), métricas síncronas e assíncronas (webhook), sessão hospedada de conexão sem login (ADR 0032) | ✅ núcleo; posts, anúncios, toolkits e gateway de LLM pendentes |
| Site de marketing (estático, `site/`): produto, preços, segurança, desenvolvedores, 4 calculadoras gratuitas, Academy (3 artigos), glossário e afiliados; SEO (metas, Open Graph, sitemap) e testes no `make ci` | ✅ v1; webinars, gerador de contratos e conteúdo contínuo pendentes |

## Fontes do levantamento

- [Reportei — página inicial](https://www.reportei.com/)
- [Reportei — integrações](https://reportei.com/integracoes/)
- [Reportei — guia de automação via WhatsApp](https://reportei.com/central-de-ajuda/guia-de-automacao-via-whatsapp-no-reportei/)
- [Reportei — automação de relatórios](https://reportei.com/automacao-de-relatorios-2-0/)
- [Reportei — API (artigo)](https://reportei.com/api-reportei-entenda-o-que-e/)
- [Reportei — documentação da API v2](https://developers.reportei.com/)
- [Reportei — MCP Server](https://developers.reportei.com/mcp)
- [Reportei — CLI](https://developers.reportei.com/cli)
- [Reportei Connect — página](https://reportei.com/connect)
- [Reportei Connect — documentação](https://developers.reportei.com/connect)
