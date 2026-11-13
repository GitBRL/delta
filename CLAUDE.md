# Delta — instruções do projeto

Plataforma de relatórios e inteligência de marketing (paridade com o Reportei + camada própria). Plano completo em `docs/PLANEJAMENTO.md`; decisões em `docs/adr/`.

## Regras do projeto

- **Só local, sem git por enquanto.** Nada vai para o GitHub e não há repositório git (não commitar). A verificação é `make ci`.
- **Sem PHP no host.** Todo PHP/Composer roda no container `api` via `./bin/compose` (usa a imagem `docker:cli` se não houver o plugin `docker compose`). Não instale PHP nem Laravel Boost no host.
- Idioma de UI, mensagens e documentação: pt-BR.

## Comandos

```
make up            # postgres, valkey, mailpit, api (:8000), horizon, scheduler
make front         # Angular (:4300) com proxy para a API
make migrate       # migrations com a role dona (delta_owner)
make test          # Pest em Postgres real (banco delta_test)
make lint          # Pint + PHPStan nível máximo
make ci            # tudo: lint, testes e build do backend e do frontend
make artisan c="route:list"
```

Na máquina de desenvolvimento a memória é curta: builds do Angular usam `NODE_OPTIONS=--max-old-space-size=1536` (o Makefile já exporta).

## Segurança multi-tenant (não negociável)

- Toda tabela nova no schema `public` precisa de RLS: use `App\Support\Database\Rls::tenantIsolation('tabela')` (tem coluna `tenant_id`) ou políticas próprias + `Rls::enable()`. O `RlsCoverageTest` falha o CI se faltar.
- A aplicação conecta como `delta_app` (sem BYPASSRLS, sem DDL). Migrations rodam com `--database=pgsql_owner`; `php artisan migrate` sem a flag falha de propósito.
- O contexto (`app.tenant_id`, `app.user_id`) é definido só por `App\Support\Tenancy\TenantContext`. Requests: middleware `tenant` (header `X-Tenant-Id`). Jobs: trait `TenantScopedJob`. Nunca filtre por tenant "na mão" no lugar do RLS.
- Consultas antes de existir contexto (login, reset de senha) passam por funções `SECURITY DEFINER` estreitas em `app.*`. Não crie novas sem ADR.
- Unicidade global sob RLS (ex.: e-mail) usa função no banco (`app.email_taken`), nunca a regra `unique:` do Laravel.
- `audit_logs` é append-only: só `INSERT` para a aplicação.

## Estrutura

- `backend/` Laravel 13 (PHP 8.5, FrankenPHP/Octane), Fortify em `/auth/*`, API da SPA em `/api/*`
- `frontend/` Angular 22: `projects/app` e `projects/design-system` (tokens HIG, componentes `ds-*`)
- `infra/` imagem PHP e script de roles do Postgres · `compose.yaml` na raiz · `bin/` utilitários
