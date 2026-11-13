# ADR 0026 — Servidor MCP

**Status:** aceita · 12/11/2026

## Contexto

O Reportei tem um servidor MCP para assistentes de IA (§1.3). O plano prevê `laravel/mcp` com OAuth 2.1 (Passport, PKCE e registro dinâmico de cliente). O OAuth exige Passport e novas buscas antes do contexto, cada uma com sua função e seu ADR. Já os tokens da API pública (ADR 0020) resolvem a autenticação hoje, e os clientes MCP atuais aceitam cabeçalho `Authorization` fixo.

## Decisões

1. **`laravel/mcp`, transporte Streamable HTTP em `POST /mcp`** (`routes/ai.php`). GET e DELETE respondem 405, como manda a especificação para servidor sem stream de notificações.
2. **Autenticação pelo token da API** (`api.token`):
   - o token precisa do escopo novo **`mcp:tools`**;
   - cada ferramenta exige ainda o escopo de leitura correspondente (`projects:read`, `metrics:read` ou `reports:read`);
   - sem esse escopo, a ferramenta **nem aparece** em `tools/list` e não pode ser chamada (o pacote filtra pela elegibilidade nos dois casos);
   - o contexto é o da agência do token, **sem usuário**, e tudo roda sob RLS, como na v1;
   - o limite é o mesmo da v1, 120 por minuto por token.
3. **Ferramentas chamam os mesmos controllers e serviços da API**, com o mesmo formato de dados, sem uma segunda implementação:
   - `list_projects`, `get_project`, `list_metrics`, `get_metrics_data`;
   - `get_performance_summary` (saúde e sinais);
   - `list_goals`, `list_timeline_events`, `list_reports`, `get_report_snapshot`.

   Os nomes seguem o snake_case do Reportei. Todas são marcadas como só leitura.
4. **Erros:**
   - projeto inexistente ou de outra agência viram resultado com `isError` e uma dica de qual ferramenta usar, sem revelar se o projeto existe em outra agência;
   - erros de validação viram texto em pt-BR.
5. **Prompts prontos:** `monthly-review` e `campaign-analysis`. Eles orientam o assistente a usar só números vindos das ferramentas.
6. **Instruções do servidor em pt-BR:** explicam projeto, chaves `canal:métrica` e métricas derivadas recalculadas dos totais.

## Consequências

- A agência conecta o Delta ao Claude ou ao Cursor criando um token com `mcp:tools` e os escopos de leitura que quiser liberar.
- **CLI `delta`** (`cli/`):
  - Node 20+, sem dependências;
  - fala com este mesmo servidor: é cliente MCP, como a CLI do Reportei;
  - perfis em `~/.config/delta/config.json` (permissão 600); `DELTA_URL` e `DELTA_TOKEN` têm precedência;
  - saída em tabela pt-BR, `--json` ou `--csv`;
  - projeto pelo id ou por parte do nome;
  - testes com servidor MCP falso em `make cli-test`, que faz parte do `make ci`.
  - modo interativo (`delta shell`): comandos em sequência sem repetir `delta`, aspas como no shell, "sair" encerra.
- **Pendente:**
  - OAuth 2.1 com registro dinâmico (Passport) e login da CLI por Device Flow, para clientes que não aceitam cabeçalho fixo;
  - ferramentas de escrita (criar meta, marco e relatório), com escopos de escrita;
  - autocompletar da CLI.
