# ADR 0005 — Núcleo de métricas: catálogo, armazenamento, consulta e modo demonstração

**Status:** aceita · 12/11/2026

## Contexto

Relatórios de marketing costumam errar em três pontos:
- somar métricas que não se somam (alcance, usuários únicos);
- calcular razões pela média diária (CTR, CPA);
- comparar períodos de forma inconsistente.

Além disso, as APIs reais (Meta, Google) dependem de aprovações que levam semanas.

## Decisões

1. **Catálogo versionado no código** (`App\Domain\Metrics\Catalog`), não em tabela. São 50 métricas em 5 canais.
   - Cada métrica tem tipo, unidade, direção ("maior é melhor"), casas decimais e, se derivada, uma fórmula.
   - O `CatalogTest` garante que as fórmulas são válidas, sem ciclos, e que só usam métricas da mesma plataforma.
   - Indicadores personalizados, que são dados de cada agência, irão para o banco.
2. **Quatro tipos de agregação** (`MetricKind`):

   | Tipo | Como se agrega no período |
   |---|---|
   | aditiva | soma dos dias |
   | snapshot | valor no último dia |
   | não aditiva | valor do período exato, vindo da plataforma, cacheado em `metric_period_values` e invalidado quando a sincronização reescreve os dias de origem |
   | derivada | fórmula sobre os **totais** do período (razão das somas) |

3. **Motor de fórmulas próprio** (`Formula`): parser descendente recursivo, sem `eval`.
   - Aceita apenas `+ - * /`, parênteses, números e referências `plataforma:métrica`.
   - Divisão por zero e operando ausente dão nulo ("sem dado"), não zero.
   - Tamanho e aninhamento são limitados.
   - É a base dos indicadores personalizados (§7.1 do plano).
4. **`metric_facts_daily` particionada por mês**, com RLS na tabela-mãe.
   - Cada partição tem os privilégios do `delta_app` e do `delta_readonly` **revogados**: o RLS não vale para quem lê a partição direto.
   - O `RlsCoverageTest` verifica isso.
   - Há uma partição `DEFAULT` de segurança.
   - O comando `metrics:partitions` (agendado todo mês, com a role dona) mantém 12 meses à frente.
5. **Modo demonstração** (`SandboxConnector`): dados determinísticos por conta, coerentes entre si (cliques ≤ impressões, alcance do período < soma diária), com sazonalidade brasileira (Black Friday, Natal, fim de semana).
   - O contrato `Connector` é o mesmo dos conectores reais, que entram no `ConnectorRegistry` conforme as aprovações saem.
6. **Várias contas da mesma plataforma em um projeto**: aditivas e snapshots somam; não aditivas somam como estimativa e saem marcadas `approximate`.
7. **Sincronização em fila** (`SyncConnectionMetrics`, fila `metrics`, Horizon).
   - Roda no contexto da agência via `TenantScopedJob`.
   - O upsert é idempotente; cada execução fica registrada em `sync_runs`.
   - O histórico inicial é de 400 dias, o suficiente para comparar com o ano anterior.

## Correções na fundação encontradas nesta fase

- **Route model binding antes do contexto.** O `SubstituteBindings` rodava antes do middleware `tenant`, então `{project}` dava 404 até para o dono (o RLS escondia o registro). `ResolveTenant` e `SetUserContext` agora entram na lista de prioridade antes do `SubstituteBindings`, e há um teste positivo de `GET /api/projects/{id}`.
- **Fila `sync`.** A limpeza de contexto em `Queue::before/after` apagava o contexto do request quando o job rodava no driver `sync`. Agora ela só vale para workers.
- **Nome de relação.** `IntegrationAccount::connection()` colidia com `Model::$connection`. Virou `integration()`.

## Pendente

- **Sincronização diária automática** de todas as agências. O agendador precisa listar conexões de todas as agências, o que o RLS bloqueia para o `delta_app`. Opções: função `SECURITY DEFINER` que devolve só `(tenant_id, connection_id)` das conexões devidas, ou um comando com a role `delta_admin`. Precisa de ADR própria (regra do projeto).
- Política `RESTRICTIVE` para o papel cliente nas tabelas de métricas. Hoje o cliente só chega às métricas pelos projetos que vê, mas a defesa no banco ainda não cobre o acesso direto.
- Moedas diferentes entre contas do mesmo projeto ainda são somadas sem conversão.
