<?php

declare(strict_types=1);

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
| Guarda do CI: nenhuma tabela nova entra no schema public sem RLS.
| Fail-closed por padrão: só escapam as tabelas globais de infraestrutura da allowlist,
| e mesmo essas não podem ter coluna tenant_id.
*/

const GLOBAL_TABLES = ['migrations', 'failed_jobs', 'job_batches', 'password_reset_tokens'];

it('exige RLS habilitada, forçada e com política em toda tabela do schema public', function () {
    $tables = DB::select(<<<'SQL'
        SELECT c.relname AS name,
               c.relrowsecurity AS rls,
               c.relforcerowsecurity AS forced,
               (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
    SQL);

    $violations = collect($tables)
        ->reject(fn (object $t) => in_array($t->name, GLOBAL_TABLES, true))
        ->filter(fn (object $t) => ! $t->rls || ! $t->forced || $t->policies < 1)
        ->pluck('name')
        ->all();

    expect($tables)->not->toBeEmpty()
        ->and($violations)->toBe([]);
});

it('restringe ao projeto do customer (Delta Connect) toda tabela com project_id', function () {
    $tables = collect(DB::select(<<<'SQL'
        SELECT c.table_name AS name FROM information_schema.columns c
        JOIN pg_class t ON t.relname = c.table_name AND t.relkind IN ('r', 'p') AND NOT t.relispartition
        WHERE c.table_schema = 'public' AND c.column_name = 'project_id'
    SQL))->pluck('name')->push('projects');
    $covered = collect(DB::select("SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = tablename || '_customer_scope' AND permissive = 'RESTRICTIVE'"))->pluck('tablename');

    expect($tables->diff($covered)->values()->all())->toBe([]);
});

it('não deixa tabelas globais carregarem dados de tenant', function () {
    $withTenant = DB::table('information_schema.columns')
        ->where('table_schema', 'public')
        ->where('column_name', 'tenant_id')
        ->whereIn('table_name', GLOBAL_TABLES)
        ->pluck('table_name')
        ->all();

    expect($withTenant)->toBe([]);
});

it('roda a aplicação com uma role que não ignora RLS e não é dona de tabelas', function () {
    $role = DB::selectOne('SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    $owned = DB::selectOne("SELECT count(*) AS total FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user");

    expect($role->rolname)->toBe('delta_app')
        ->and($role->rolsuper)->toBeFalse()
        ->and($role->rolbypassrls)->toBeFalse()
        ->and($owned->total)->toBe(0);
});

it('não deixa a aplicação acessar partições direto (o RLS vale na tabela-mãe)', function () {
    $partitions = DB::select(<<<'SQL'
        SELECT c.relname AS name,
               has_table_privilege('delta_app', c.oid, 'SELECT, INSERT, UPDATE, DELETE') AS app_access,
               has_table_privilege('delta_readonly', c.oid, 'SELECT') AS readonly_access
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relispartition AND c.relkind = 'r'
    SQL);

    $exposed = collect($partitions)->filter(fn (object $p) => $p->app_access || $p->readonly_access)->pluck('name')->all();

    expect($partitions)->not->toBeEmpty()
        ->and($exposed)->toBe([]);
});

it('recusa leitura direta de partição pela role da aplicação', function () {
    $partition = DB::scalar("SELECT c.relname FROM pg_class c WHERE c.relispartition AND c.relkind = 'r' AND c.relname LIKE 'metric_facts_daily_%' LIMIT 1");

    expect(fn () => DB::transaction(fn () => DB::select("SELECT count(*) FROM {$partition}")))
        ->toThrow(QueryException::class, 'permission denied');
});
