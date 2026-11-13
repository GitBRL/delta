<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Projetos (= cliente final da agência) e seus membros.
 *
 * Além do isolamento por tenant, projects tem uma política RESTRICTIVE: usuários com papel
 * "client" só enxergam projetos dos quais são membros. Políticas permissivas combinam com OU;
 * a restritiva combina com E, então nunca amplia acesso por engano.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('projects', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('niche', 60)->nullable();
            $table->jsonb('settings')->default('{}');
            $table->timestampsTz();

            $table->index(['tenant_id', 'name']);
        });

        Schema::create('project_members', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->timestampsTz();

            $table->unique(['project_id', 'user_id']);
            $table->index(['tenant_id', 'user_id']);
        });

        Rls::tenantIsolation('projects');
        Rls::tenantIsolation('project_members');

        // Staff = qualquer papel diferente de "client" no tenant do contexto.
        // Sem usuário no contexto (jobs de sistema já restritos a um tenant) também conta como staff.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.is_staff() RETURNS boolean
                LANGUAGE sql STABLE
                AS $$
                    SELECT app.current_user_id() IS NULL
                        OR EXISTS (
                            SELECT 1 FROM public.tenant_user tu
                            WHERE tu.tenant_id = app.current_tenant()
                              AND tu.user_id = app.current_user_id()
                              AND tu.role <> 'client'
                        )
                $$
        SQL);
        DB::statement('GRANT EXECUTE ON FUNCTION app.is_staff() TO delta_app, delta_admin, delta_readonly');

        DB::statement(<<<'SQL'
            CREATE POLICY projects_client_scope ON projects AS RESTRICTIVE
                USING (
                    (SELECT app.is_staff())
                    OR EXISTS (
                        SELECT 1 FROM project_members pm
                        WHERE pm.project_id = projects.id AND pm.user_id = (SELECT app.current_user_id())
                    )
                )
        SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('project_members');
        Schema::dropIfExists('projects');
        DB::statement('DROP FUNCTION IF EXISTS app.is_staff()');
    }
};
