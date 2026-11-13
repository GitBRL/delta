# ADR 0001 — Multi-tenancy com Row Level Security no PostgreSQL

**Status:** aceita · 12/11/2026

## Contexto

O Delta guarda dados de marketing de muitas agências e dos clientes delas. Um vazamento entre agências é o pior incidente possível para o produto. Filtrar por `tenant_id` só no código depende de nunca esquecer um `where`.

## Decisão

- Banco único, schema único, coluna `tenant_id uuid` em toda tabela de negócio, com **RLS habilitada e forçada**.
- Contexto na sessão do Postgres: `app.tenant_id` e `app.user_id`, lidos por `app.current_tenant()` e `app.current_user_id()`. Sem contexto, as funções retornam `NULL` e nenhuma linha passa (fail-closed).
- Roles:

  | Role | Uso | Atributos |
  |---|---|---|
  | `delta_owner` | dono das tabelas, migrations, funções `SECURITY DEFINER` | `BYPASSRLS` |
  | `delta_app` | API e workers | `NOBYPASSRLS`, sem DDL, sem acesso a `migrations` |
  | `delta_admin` | backoffice futuro | `BYPASSRLS`, uso auditado |
  | `delta_readonly` | BI interno | só leitura, sujeito a RLS |

- Na aplicação, `TenantContext` é a única fonte do contexto:
  - o middleware global `ResetDatabaseContext` limpa no início e no fim de cada request;
  - os listeners do Octane limpam entre operações;
  - os workers limpam antes e depois de cada job;
  - `ConnectionEstablished` reaplica o contexto se a conexão cair.
- O papel `client` recebe uma política `RESTRICTIVE` extra (só projetos dos quais é membro).
- Defesa em profundidade: `TenantScope` no Eloquent também filtra (e retorna vazio sem tenant).
- Guarda automática: `RlsCoverageTest` falha se qualquer tabela do `public` (fora de uma allowlist de infraestrutura sem `tenant_id`) estiver sem RLS, sem `FORCE` ou sem política.

## Consequências

- Migrations precisam rodar com `--database=pgsql_owner` (`make migrate`).
- Unicidade global (e-mail, slug) não pode ser verificada com `SELECT` comum; usa funções no banco ou sufixo aleatório.
- **Não usar PgBouncer em modo *transaction*** com variáveis de sessão. Se for necessário, migrar para `SET LOCAL` dentro de transação por request.
- Tabelas globais permitidas sem RLS: `migrations`, `failed_jobs`, `job_batches`, `password_reset_tokens`.
