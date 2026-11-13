<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Saúde da conta (nota diária por projeto) e plano de ação com medição de impacto. ADR 0018.
 * Leitura com o escopo de cliente dos projetos; escrita só da equipe.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('health_scores_daily', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->unsignedSmallInteger('score');
            $table->unsignedSmallInteger('critical')->default(0);
            $table->unsignedSmallInteger('attention')->default(0);
            $table->unsignedSmallInteger('opportunity')->default(0);
            $table->timestampTz('created_at')->useCurrent();

            $table->unique(['project_id', 'date']);
        });

        Schema::create('actions', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->string('rule', 120)->nullable();
            $table->string('metric_key', 120);
            $table->string('title', 160);
            $table->string('suggestion', 1000)->nullable();
            $table->string('status', 12)->default('open'); // open | doing | done | dismissed
            $table->uuid('assignee_id')->nullable();
            $table->date('due_on')->nullable();
            $table->string('dismissed_reason', 300)->nullable();
            $table->timestampTz('applied_at')->nullable();
            $table->jsonb('baseline')->nullable();
            $table->jsonb('outcome')->nullable();
            $table->timestampTz('measured_at')->nullable();
            $table->string('feedback', 12)->nullable(); // useful | not_useful
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();

            $table->index(['tenant_id', 'project_id', 'status']);
        });
        DB::statement("ALTER TABLE actions ADD CONSTRAINT actions_status_check CHECK (status IN ('open', 'doing', 'done', 'dismissed'))");

        foreach (['health_scores_daily', 'actions'] as $table) {
            Rls::tenantIsolation($table);
            DB::statement(<<<SQL
                CREATE POLICY {$table}_client_scope ON {$table} AS RESTRICTIVE FOR SELECT
                    USING (
                        (SELECT app.is_staff())
                        OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = {$table}.project_id AND pm.user_id = (SELECT app.current_user_id()))
                    )
            SQL);
            DB::statement("CREATE POLICY {$table}_staff_insert ON {$table} AS RESTRICTIVE FOR INSERT WITH CHECK ((SELECT app.is_staff()))");
            DB::statement("CREATE POLICY {$table}_staff_update ON {$table} AS RESTRICTIVE FOR UPDATE USING ((SELECT app.is_staff())) WITH CHECK ((SELECT app.is_staff()))");
            DB::statement("CREATE POLICY {$table}_staff_delete ON {$table} AS RESTRICTIVE FOR DELETE USING ((SELECT app.is_staff()))");
        }

        // Rotinas diárias entre agências: só ids (padrão da ADR 0012).
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.tenants_with_projects()
                RETURNS TABLE (tenant_id uuid)
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$ SELECT DISTINCT p.tenant_id FROM public.projects p $$
        SQL);
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.actions_to_measure(p_before timestamptz)
                RETURNS TABLE (tenant_id uuid, action_id uuid)
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    SELECT a.tenant_id, a.id FROM public.actions a
                    WHERE a.status = 'done' AND a.outcome IS NULL AND a.applied_at <= p_before
                    LIMIT 1000
                $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION app.tenants_with_projects(), app.actions_to_measure(timestamptz) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION app.tenants_with_projects(), app.actions_to_measure(timestamptz) TO delta_app');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS app.actions_to_measure(timestamptz)');
        DB::statement('DROP FUNCTION IF EXISTS app.tenants_with_projects()');
        Schema::dropIfExists('actions');
        Schema::dropIfExists('health_scores_daily');
    }
};
