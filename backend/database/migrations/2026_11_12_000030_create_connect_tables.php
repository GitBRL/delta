<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Delta Connect (ADR 0032): a agência (merchant) expõe projetos (customers) para o próprio SaaS.
 *  - customer = projeto, com token próprio ("dct_", só o hash no banco);
 *  - com o customer no contexto (app.customer_project_id), uma política RESTRICTIVE em TODA tabela
 *    com project_id limita as linhas ao projeto dele;
 *  - sessão hospedada: página pública (sem login) onde o cliente final conecta as contas.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.current_customer_project() RETURNS uuid
                LANGUAGE sql STABLE PARALLEL SAFE
                AS $$ SELECT NULLIF(current_setting('app.customer_project_id', true), '')::uuid $$
        SQL);
        DB::statement('GRANT EXECUTE ON FUNCTION app.current_customer_project() TO delta_app, delta_admin, delta_readonly');

        Schema::create('connect_customers', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('external_id', 120)->nullable();
            $table->char('token_hash', 64)->unique();
            $table->string('token_prefix', 12);
            $table->jsonb('metadata')->default('{}');
            $table->timestampTz('revoked_at')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'external_id']);
        });

        Schema::create('connect_sessions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('customer_id')->constrained('connect_customers')->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->char('token_hash', 64)->unique();
            $table->jsonb('platforms');
            $table->string('return_url', 500)->nullable();
            $table->timestampTz('expires_at');
            $table->jsonb('connected')->default('[]');
            $table->timestampsTz();
        });

        Schema::table('oauth_states', function (Blueprint $table): void {
            $table->foreignUuid('connect_session_id')->nullable()->constrained('connect_sessions')->cascadeOnDelete();
        });

        // Customers e sessões: só o sistema (API do merchant e jobs, sem usuário) ou dono/admin.
        foreach (['connect_customers', 'connect_sessions'] as $table) {
            Rls::tenantIsolation($table);
            DB::statement("CREATE POLICY {$table}_merchant ON {$table} AS RESTRICTIVE USING ((SELECT app.current_user_id()) IS NULL OR (SELECT app.is_tenant_admin())) WITH CHECK ((SELECT app.current_user_id()) IS NULL OR (SELECT app.is_tenant_admin()))");
        }

        // Escopo do customer em todas as tabelas com project_id (e em projects, pelo id).
        Rls::customerScope('projects', 'id');
        $tables = DB::select("SELECT c.table_name FROM information_schema.columns c JOIN pg_class t ON t.relname = c.table_name AND t.relkind IN ('r', 'p') AND NOT t.relispartition WHERE c.table_schema = 'public' AND c.column_name = 'project_id' ORDER BY c.table_name");
        foreach ($tables as $row) {
            $name = is_object($row) && is_string($row->table_name ?? null) ? $row->table_name : '';
            Rls::customerScope($name);
        }

        // Página pública da sessão hospedada: busca exata pelo hash do token, só ids e validade.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.connect_session_by_token(p_token_hash text)
                RETURNS TABLE (session_id uuid, tenant_id uuid, project_id uuid, expires_at timestamptz)
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$ SELECT s.id, s.tenant_id, s.project_id, s.expires_at FROM public.connect_sessions s WHERE s.token_hash = p_token_hash LIMIT 1 $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION app.connect_session_by_token(text) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION app.connect_session_by_token(text) TO delta_app');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS app.connect_session_by_token(text)');
        $tables = DB::select("SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE '%\\_customer\\_scope'");
        foreach ($tables as $row) {
            if (is_object($row) && is_string($row->policyname ?? null) && is_string($row->tablename ?? null)) {
                DB::statement("DROP POLICY IF EXISTS \"{$row->policyname}\" ON \"{$row->tablename}\"");
            }
        }
        Schema::table('oauth_states', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('connect_session_id');
        });
        Schema::dropIfExists('connect_sessions');
        Schema::dropIfExists('connect_customers');
        DB::statement('DROP FUNCTION IF EXISTS app.current_customer_project()');
    }
};
