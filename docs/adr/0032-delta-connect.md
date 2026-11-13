# ADR 0032 — Delta Connect: customers, isolamento por projeto e sessão hospedada

**Status:** aceita · 12/11/2026 · primeira fatia

## Contexto

O Reportei Connect deixa outros SaaS usarem a plataforma com os próprios clientes. O modelo é merchant → customers → integrações. O plano define que o merchant é uma agência (tenant) e que o `x-customer-token` restringe ao projeto (customer) por uma política `RESTRICTIVE`.

## Decisões

1. **Merchant = agência; customer = projeto.**
   - **merchant:** usa o token da API (ADR 0020) com o escopo novo **`connect`**, e as rotas exigem o recurso `api` do plano;
   - **customer:**
     - cada um ganha um token próprio, **`dct_` + 40 caracteres**, mostrado só na criação e na rotação (o banco guarda o sha256 e o prefixo);
     - aceita `external_id` (único por agência) e `metadata`;
     - revogar corta o acesso na hora; o projeto e os dados continuam na agência.
2. **Isolamento pelo banco:**
   - o middleware `connect.customer` (cabeçalho `X-Customer-Token`) coloca o projeto em **`app.customer_project_id`**, a terceira variável do contexto de segurança (`TenantContext`);
   - **toda tabela com `project_id`** (e `projects`, pelo `id`) ganhou a política `*_customer_scope` (`RESTRICTIVE`): com o customer no contexto, leitura e escrita só nas linhas do projeto dele;
   - o `RlsCoverageTest` falha se alguma tabela com `project_id` ficar sem essa política, incluindo as futuras (`Rls::customerScope`);
   - o contexto do customer é limpo em todo request e quando a agência do contexto muda.
3. **Endpoints** em `/api/connect/v1`:
   - **merchant:**
     - `GET/POST /customers`, `GET/PATCH/DELETE /customers/{id}`, `POST /customers/{id}/token` (rotação);
     - `GET /integrations` (catálogo com os modos disponíveis);
     - `POST /customer-integrations/session`;
   - **customer:**
     - `GET /customer`, com as integrações;
     - `GET /metrics`, o catálogo das integrações do customer, com `reference_key`;
     - `POST /metrics/get-data`, síncrono, no formato da consulta de métricas;
     - `POST /metrics/get-data-async`: responde 202 com `request_id`. O resultado chega pelo webhook assinado **`connect.metrics_ready`** (ADR 0020), já com as novas tentativas.
4. **Sessão hospedada** (`connect_sessions`): o merchant cria um link (`/conectar/{token}`) com estas regras:
   - **limites do link:** 48 caracteres, **30 minutos** de validade e só as plataformas escolhidas;
   - **sem login:** o cliente final conecta as contas pela página, sem conta no Delta;
   - **função nova `app.connect_session_by_token(hash)`:** `SECURITY DEFINER`, busca exata e devolve só ids e validade;
   - **OAuth (`/oauth/{p}/start?connect_session=…`):** é o mesmo fluxo de pop-up. O estado do OAuth passa a pertencer à pessoa logada **ou** à sessão (restrição no banco: um dos dois é obrigatório). Na volta, as contas conectadas **vão direto para o projeto do customer**, e o merchant recebe o webhook `customer_integration.connected`;
   - **recusas:** plataforma fora da sessão e link vencido são recusados com mensagem em pt-BR.
5. **Sanctum não lê `Bearer`.** A SPA autentica só por cookie, e `Bearer` é exclusivo dos tokens da API. Antes, com um `Bearer`, qualquer `$request->user()`, inclusive no registro de exceções, tentava ler `personal_access_tokens` (tabela inexistente).
6. **402 de plano** é regra de negócio: não vai para o log (`ShouldntReport`).

## Pendente

- **login só por pop-up na sessão hospedada:**
  - no modo redirect, a volta do OAuth cai em `/integracoes`, que exige login;
  - com pop-up bloqueado, a página pede para liberar pop-ups;
  - a correção é uma volta própria para a sessão.
- posts, anúncios e mídia por customer (paridade completa);
- toolkits e gateway de LLM;
- limites por merchant e por funcionalidade; histórico e reenvio de webhooks na tela.
