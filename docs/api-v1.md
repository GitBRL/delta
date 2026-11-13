# API pública do Delta — v1

A API permite que sistemas da agência (BI, CRM, automações) leiam projetos, métricas e relatórios, publiquem relatórios e recebam eventos por webhook.

- **Base:** `https://<seu-domínio-delta>/api/v1` (em desenvolvimento: `http://localhost:8000/api/v1`)
- **Formato:** JSON (UTF-8). Datas no formato `YYYY-MM-DD`; instantes em ISO 8601.

## Autenticação

Crie um token em **Configurações › API e webhooks**. Só dono e administrador podem criar. O token aparece **uma única vez**.

```http
GET /api/v1/projects
Authorization: Bearer dlt_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

- **O token pertence à agência**, não a uma pessoa: continua valendo se quem o criou sair da equipe.
- **Validade:** opcional, de 1 a 730 dias.
- **Revogação:** a qualquer momento.
- **Erros de autenticação:**
  - `401`: token inválido, expirado ou revogado;
  - `403`: o token não tem o escopo exigido pela rota.

### Escopos

| Escopo | Permite |
|---|---|
| `projects:read` | Ler projetos e contas vinculadas |
| `metrics:read` | Consultar métricas e indicadores (catálogo, personalizados e fonte manual) |
| `reports:read` | Ler relatórios, versões publicadas e PDFs |
| `reports:write` | Publicar relatórios |
| `webhooks:manage` | Gerenciar webhooks |
| `mcp:tools` | Usar o servidor MCP (assistentes de IA), com as leituras liberadas pelos outros escopos |

### Limites

- 120 requisições por minuto por token (`429` ao exceder, com `Retry-After`).
- Publicar relatório: 20 por minuto.

## Endpoints

| Método | Rota | Escopo | Descrição |
|---|---|---|---|
| GET | `/projects` | projects:read | Projetos da agência |
| GET | `/projects/{id}` | projects:read | Um projeto |
| GET | `/metrics` | metrics:read | Todas as métricas disponíveis para a agência |
| POST | `/projects/{id}/metrics/query` | metrics:read | Consulta de métricas (abaixo) |
| GET | `/reports` | reports:read | Relatórios (montador) |
| POST | `/reports/{id}/snapshots` | reports:write | Publica uma versão (PDF gerado em seguida) |
| GET | `/projects/{id}/snapshots` | reports:read | Versões publicadas de um projeto |
| GET | `/snapshots/{id}` | reports:read | Uma versão publicada, com os dados |
| GET | `/snapshots/{id}/pdf` | reports:read | PDF (`202` enquanto gera, `409` se falhou) |
| GET / POST | `/webhooks` | webhooks:manage | Lista e cria webhooks |
| DELETE | `/webhooks/{id}` | webhooks:manage | Remove um webhook |

### Consulta de métricas

```http
POST /api/v1/projects/{id}/metrics/query
Content-Type: application/json

{ "start": "2026-10-01", "end": "2026-10-31", "compare": "previous_period",
  "metrics": ["meta_ads:spend", "meta_ads:roas", "custom:roas_real"], "series": true }
```

- **`compare`:** `previous_period`, `previous_year` ou `none`.
- **Período:** os dados vão até ontem, com no máximo 400 dias.
- **Resposta:** cada métrica traz `value`, `previous`, `change_pct`, `sentiment`, `approximate` e, com `series: true`, as séries diárias.
- **Agregação:**
  - aditivas (gasto, cliques) somam os dias;
  - razões (CTR, CPA, ROAS) são calculadas pela razão das somas;
  - alcance e usuários vêm do período exato.

## Webhooks

O Delta envia um `POST` com JSON para a URL cadastrada:

```json
{
  "id": "0193…",
  "event": "report.published",
  "created_at": "2026-11-12T18:00:00-03:00",
  "data": { "snapshot_id": "…", "report_id": "…", "project_id": "…", "title": "Relatório mensal", "period": { "start": "2026-10-01", "end": "2026-10-31" } }
}
```

### Eventos

| Evento | Quando |
|---|---|
| `report.published` | Uma versão de relatório foi publicada |
| `automation.sent` / `automation.failed` | Um envio automático terminou (com o número de entregas e falhas) |
| `goal.status_changed` | Uma meta mudou de estado (`on_track`, `at_risk`, `off_track`, `achieved`) |
| `connection.expired` | O acesso a uma plataforma expirou (é preciso reconectar) |
| `action.measured` | O impacto de uma ação aplicada foi medido |
| `ping` | Teste disparado pela tela de webhooks |

Use `"events": ["*"]` para receber todos.

### Verificar a assinatura

Toda entrega traz os cabeçalhos:
- `X-Delta-Event`: o evento;
- `X-Delta-Delivery`: o id da entrega, que serve para tratar repetições;
- `X-Delta-Signature: t=<unix>,v1=<assinatura>`.

A assinatura é `HMAC-SHA256(segredo, "<t>.<corpo bruto>")` em hexadecimal. O segredo (`whsec_…`) aparece na criação e na rotação.

```php
[$t, $v1] = [null, null];
foreach (explode(',', $_SERVER['HTTP_X_DELTA_SIGNATURE']) as $part) {
    [$k, $v] = explode('=', $part, 2);
    ${$k === 't' ? 't' : 'v1'} = $v;
}
$body = file_get_contents('php://input');
$valid = hash_equals(hash_hmac('sha256', "{$t}.{$body}", $secret), $v1) && abs(time() - (int) $t) < 300;
```

```js
const [t, v1] = req.headers['x-delta-signature'].split(',').map((p) => p.split('=')[1]);
const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1)) && Math.abs(Date.now() / 1000 - t) < 300;
```

### Entrega

- **Sucesso:** responda `2xx` em até 10 segundos.
- **Fora disso:** novas tentativas em 1 min, 5 min, 30 min, 2 h, 6 h, 12 h e 24 h.
- **Desativação:** após 20 entregas que falharam todas as tentativas, o webhook é desativado e precisa ser reativado na tela.
- **Redirecionamentos:** não são seguidos.
- **Destinos:** só URLs `https` públicas. Endereços internos são recusados.
- **Repetições:** pode haver entrega repetida. Use `X-Delta-Delivery` para ignorar duplicadas.

## Servidor MCP (assistentes de IA)

O Delta tem um servidor [MCP](https://modelcontextprotocol.io) em `POST /mcp`, no transporte Streamable HTTP. Ele serve para usar os dados da agência dentro do Claude, do Cursor e de outros assistentes de IA. Veja o ADR 0026.

- **Autenticação:** o mesmo token da API (`Authorization: Bearer dlt_…`), que precisa ter o escopo `mcp:tools`.
- **Ferramentas visíveis:** cada ferramenta só aparece se o token também tiver o escopo de leitura dela.
- **Limite:** o mesmo da v1, 120 chamadas por minuto por token.
- **Leitura apenas:** nesta versão o MCP não grava nada.

| Ferramenta | Escopo | O que faz |
|---|---|---|
| `list_projects` | `projects:read` | Projetos (clientes) da agência |
| `get_project` | `projects:read` | Dados de negócio e contas conectadas de um projeto |
| `list_goals` | `projects:read` | Metas com progresso, ritmo e projeção |
| `list_timeline_events` | `projects:read` | Marcos manuais e automáticos do projeto |
| `list_metrics` | `metrics:read` | Catálogo de métricas, com filtro por canal e por texto |
| `get_metrics_data` | `metrics:read` | Valores do período, com comparação e série diária opcional |
| `get_performance_summary` | `metrics:read` | Saúde da conta e sinais de atenção dos últimos 7 dias |
| `list_reports` | `reports:read` | Relatórios e versões publicadas |
| `get_report_snapshot` | `reports:read` | Conteúdo de uma versão publicada |

Há também dois prompts prontos:
- `monthly-review` (análise do mês);
- `campaign-analysis` (diagnóstico da mídia paga).

Exemplo de configuração num cliente MCP que aceita servidor HTTP com cabeçalho:

```json
{
  "mcpServers": {
    "delta": {
      "type": "http",
      "url": "https://api.seu-dominio.com/mcp",
      "headers": { "Authorization": "Bearer dlt_..." }
    }
  }
}
```

## Delta Connect (para outros SaaS)

O seu SaaS cria **customers** (um projeto para cada cliente seu), conecta as contas deles por uma página hospedada e consulta as métricas. Veja o ADR 0032.

- **Token do merchant:** o token da API com o escopo `connect`.
- **Rotas de customer:** pedem também `X-Customer-Token: dct_…`. Esse token é mostrado uma única vez, na criação ou na rotação. Tudo o que ele acessa fica restrito ao projeto do customer, e o próprio banco garante isso.

| Método | Rota | Uso |
|---|---|---|
| GET/POST | `/api/connect/v1/customers` | Listar e criar (`name`, `external_id`, `niche`, `metadata`) → `customer_token` |
| GET/PATCH/DELETE | `/api/connect/v1/customers/{id}` | Detalhe com integrações, atualizar, revogar |
| POST | `/api/connect/v1/customers/{id}/token` | Novo token (o anterior deixa de valer) |
| GET | `/api/connect/v1/integrations` | Plataformas e modos disponíveis |
| POST | `/api/connect/v1/customer-integrations/session` | Link de 30 min para o cliente conectar as contas (`customer_id`, `platforms`, `return_url`) |
| GET | `/api/connect/v1/customer` | (customer) dados e integrações |
| GET | `/api/connect/v1/metrics` | (customer) métricas disponíveis (`reference_key`) |
| POST | `/api/connect/v1/metrics/get-data` | (customer) consulta síncrona (`metrics`, `start`, `end`, `compare`, `series`) |
| POST | `/api/connect/v1/metrics/get-data-async` | (customer) 202 + `request_id`; o resultado chega no webhook `connect.metrics_ready` |

Eventos de webhook do Connect:
- `connect.metrics_ready`;
- `customer_integration.connected`.
