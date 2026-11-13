<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Fundação de segurança: schema "app" com as funções que leem o contexto da sessão.
 *
 * O contexto é definido pela aplicação a cada request/job com:
 *   select set_config('app.tenant_id', <uuid>, false), set_config('app.user_id', <uuid>, false)
 *
 * NULLIF é necessário porque, depois de um RESET ou de um set_config com '', a variável
 * volta como string vazia (não NULL) e o cast para uuid falharia.
 * Sem contexto, as funções retornam NULL e nenhuma política de tenant é satisfeita (fail-closed).
 */
return new class extends Migration
{
    public function up(): void
    {
        // migrate:fresh apaga as tabelas, mas não as funções do schema app: recriar do zero evita
        // que uma versão antiga de função (com outra assinatura) sobreviva entre recriações do banco.
        // Esta migration só roda em banco novo (ou fresh), então nada em uso é perdido.
        DB::statement('DROP SCHEMA IF EXISTS app CASCADE');
        DB::statement('CREATE SCHEMA app');
        DB::statement('REVOKE ALL ON SCHEMA app FROM PUBLIC');
        DB::statement('GRANT USAGE ON SCHEMA app TO delta_app, delta_admin, delta_readonly');

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid
                LANGUAGE sql STABLE PARALLEL SAFE
                AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$
        SQL);

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
                LANGUAGE sql STABLE PARALLEL SAFE
                AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$
        SQL);

        DB::statement('GRANT EXECUTE ON FUNCTION app.current_tenant(), app.current_user_id() TO delta_app, delta_admin, delta_readonly');

        // A aplicação não tem por que ler ou alterar o histórico de migrations.
        DB::statement('REVOKE ALL ON TABLE migrations FROM delta_app, delta_readonly');
    }

    public function down(): void
    {
        DB::statement('DROP SCHEMA IF EXISTS app CASCADE');
    }
};
