# Backend do Delta

Leia `../CLAUDE.md` (regras do projeto). Resumo para o backend:

- PHP e Composer rodam só no container: `make test`, `make lint`, `make artisan c="..."`, `make composer c="..."` a partir da raiz.
- Toda tabela nova precisa de RLS (`App\Support\Database\Rls`); migrations com `--database=pgsql_owner` (`make migrate`).
- Testes em Postgres real (`delta_test`); helpers de contexto em `tests/Pest.php` (`security()`, `tenantWithOwner()`, `asTenant()`).
- PHPStan no nível máximo e Pint precisam passar.
