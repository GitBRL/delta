<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Identidade e tenancy: tenants (agências), users (globais) e tenant_user (vínculo + papel).
 *
 * Um usuário pode pertencer a várias agências, por isso "users" não tem tenant_id.
 * Visibilidade:
 *  - tenants:     o tenant do contexto + os tenants dos quais o usuário do contexto é membro
 *  - tenant_user: os vínculos do usuário do contexto + os vínculos do tenant do contexto
 *  - users:       o próprio usuário + colegas do tenant do contexto
 *
 * Login, sessão e reset de senha precisam achar o usuário ANTES de existir contexto.
 * Para isso existem funções SECURITY DEFINER estreitas (busca exata por id ou e-mail),
 * executáveis só pelo delta_app. Ver docs/adr/0002.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenants', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->string('name');
            $table->string('slug')->unique();
            $table->jsonb('settings')->default('{}');
            $table->timestampsTz();
        });

        Schema::create('users', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->string('name');
            $table->string('email');
            $table->timestampTz('email_verified_at')->nullable();
            $table->string('password');
            $table->text('two_factor_secret')->nullable();
            $table->text('two_factor_recovery_codes')->nullable();
            $table->timestampTz('two_factor_confirmed_at')->nullable();
            $table->rememberToken();
            $table->timestampsTz();
        });
        DB::statement('CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email))');

        Schema::create('tenant_user', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->string('role', 20);
            $table->timestampsTz();

            $table->unique(['tenant_id', 'user_id']);
            $table->index('user_id');
        });
        DB::statement("ALTER TABLE tenant_user ADD CONSTRAINT tenant_user_role_check CHECK (role IN ('owner', 'admin', 'analyst', 'client'))");

        // Tabela global do broker de senha (consultada antes de existir contexto). Ver ADR 0002.
        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestampTz('created_at')->nullable();
        });

        $this->policies();
        $this->authFunctions();
    }

    private function policies(): void
    {
        // tenant_user primeiro: as políticas de tenants e users consultam esta tabela.
        Rls::enable('tenant_user');
        DB::statement(<<<'SQL'
            CREATE POLICY tenant_user_select ON tenant_user FOR SELECT
                USING (user_id = (SELECT app.current_user_id()) OR tenant_id = (SELECT app.current_tenant()))
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY tenant_user_write ON tenant_user FOR INSERT
                WITH CHECK (tenant_id = (SELECT app.current_tenant()))
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY tenant_user_update ON tenant_user FOR UPDATE
                USING (tenant_id = (SELECT app.current_tenant()))
                WITH CHECK (tenant_id = (SELECT app.current_tenant()))
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY tenant_user_delete ON tenant_user FOR DELETE
                USING (tenant_id = (SELECT app.current_tenant()))
        SQL);

        Rls::enable('tenants');
        DB::statement(<<<'SQL'
            CREATE POLICY tenants_select ON tenants FOR SELECT
                USING (
                    id = (SELECT app.current_tenant())
                    OR EXISTS (
                        SELECT 1 FROM tenant_user tu
                        WHERE tu.tenant_id = tenants.id AND tu.user_id = (SELECT app.current_user_id())
                    )
                )
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY tenants_insert ON tenants FOR INSERT
                WITH CHECK (id = (SELECT app.current_tenant()))
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY tenants_update ON tenants FOR UPDATE
                USING (id = (SELECT app.current_tenant()))
                WITH CHECK (id = (SELECT app.current_tenant()))
        SQL);
        // Sem política de DELETE: exclusão de agência é fluxo administrativo (delta_admin).

        Rls::enable('users');
        DB::statement(<<<'SQL'
            CREATE POLICY users_select ON users FOR SELECT
                USING (
                    id = (SELECT app.current_user_id())
                    OR EXISTS (
                        SELECT 1 FROM tenant_user tu
                        WHERE tu.user_id = users.id AND tu.tenant_id = (SELECT app.current_tenant())
                    )
                )
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY users_insert ON users FOR INSERT
                WITH CHECK (id = (SELECT app.current_user_id()))
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY users_update ON users FOR UPDATE
                USING (id = (SELECT app.current_user_id()))
                WITH CHECK (id = (SELECT app.current_user_id()))
        SQL);
        // Sem política de DELETE: exclusão de conta é fluxo administrativo e auditado.
    }

    private function authFunctions(): void
    {
        // SECURITY DEFINER roda como delta_owner (BYPASSRLS). search_path fixo evita sequestro
        // por objetos com o mesmo nome em outro schema.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.auth_user_by_id(p_id uuid) RETURNS SETOF public.users
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$ SELECT * FROM public.users WHERE id = p_id LIMIT 1 $$
        SQL);

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.auth_user_by_email(p_email text) RETURNS SETOF public.users
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$ SELECT * FROM public.users WHERE lower(email) = lower(p_email) LIMIT 1 $$
        SQL);

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.email_taken(p_email text, p_except uuid DEFAULT NULL) RETURNS boolean
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    SELECT EXISTS (
                        SELECT 1 FROM public.users
                        WHERE lower(email) = lower(p_email) AND (p_except IS NULL OR id <> p_except)
                    )
                $$
        SQL);

        DB::statement('REVOKE ALL ON FUNCTION app.auth_user_by_id(uuid), app.auth_user_by_email(text), app.email_taken(text, uuid) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION app.auth_user_by_id(uuid), app.auth_user_by_email(text), app.email_taken(text, uuid) TO delta_app');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS app.email_taken(text, uuid)');
        DB::statement('DROP FUNCTION IF EXISTS app.auth_user_by_email(text)');
        DB::statement('DROP FUNCTION IF EXISTS app.auth_user_by_id(uuid)');
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('tenant_user');
        Schema::dropIfExists('users');
        Schema::dropIfExists('tenants');
    }
};
