<?php

declare(strict_types=1);

namespace App\Support\Database;

use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * Helpers de Row Level Security para migrations.
 *
 * Toda tabela de negócio precisa passar por aqui. O teste RlsCoverageTest falha se
 * existir tabela no schema public sem RLS habilitada + forçada + ao menos uma política.
 *
 * As chamadas de função nas políticas vão dentro de "(SELECT ...)" para o planner
 * avaliá-las uma vez por consulta (initPlan) e não uma vez por linha.
 */
final class Rls
{
    public static function enable(string $table): void
    {
        $table = self::identifier($table);

        DB::statement("ALTER TABLE {$table} ENABLE ROW LEVEL SECURITY");
        DB::statement("ALTER TABLE {$table} FORCE ROW LEVEL SECURITY");
    }

    /**
     * Isolamento padrão por tenant: a linha só existe para quem está no contexto do tenant dela.
     * Também faz tenant_id ser preenchido pelo contexto quando omitido no INSERT.
     */
    public static function tenantIsolation(string $table): void
    {
        self::enable($table);
        $table = self::identifier($table);

        DB::statement("ALTER TABLE {$table} ALTER COLUMN tenant_id SET DEFAULT app.current_tenant()");
        DB::statement(<<<SQL
            CREATE POLICY tenant_isolation ON {$table}
                USING      (tenant_id = (SELECT app.current_tenant()))
                WITH CHECK (tenant_id = (SELECT app.current_tenant()))
        SQL);
    }

    /**
     * Delta Connect (ADR 0032): com um customer no contexto, só as linhas do projeto dele.
     * Toda tabela com project_id precisa desta política (o RlsCoverageTest confere).
     */
    public static function customerScope(string $table, string $column = 'project_id'): void
    {
        $table = self::identifier($table);
        $column = self::identifier($column);

        DB::statement(<<<SQL
            CREATE POLICY {$table}_customer_scope ON {$table} AS RESTRICTIVE
                USING      ((SELECT app.current_customer_project()) IS NULL OR {$column} = (SELECT app.current_customer_project()))
                WITH CHECK ((SELECT app.current_customer_project()) IS NULL OR {$column} = (SELECT app.current_customer_project()))
        SQL);
    }

    private static function identifier(string $name): string
    {
        if (preg_match('/^[a-z_][a-z0-9_]*$/', $name) !== 1) {
            throw new InvalidArgumentException("Identificador inválido: {$name}");
        }

        return $name;
    }
}
