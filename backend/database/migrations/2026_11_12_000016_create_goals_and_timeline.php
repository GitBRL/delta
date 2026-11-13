<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Metas por projeto com alertas e a linha do tempo (marcos manuais e automáticos). ADR 0017.
 * Leitura com o mesmo escopo de cliente dos projetos; escrita só da equipe.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('goals', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->string('metric_key', 120);
            $table->string('comparison', 10); // at_least | at_most
            $table->decimal('target', 20, 6);
            $table->string('period', 10)->default('month'); // month | week
            $table->boolean('active')->default(true);
            $table->string('last_status', 12)->nullable();
            $table->string('last_period', 10)->nullable(); // ex.: 2026-11 / 2026-W46
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();

            $table->index(['tenant_id', 'project_id']);
        });
        DB::statement("ALTER TABLE goals ADD CONSTRAINT goals_comparison_check CHECK (comparison IN ('at_least', 'at_most'))");
        DB::statement("ALTER TABLE goals ADD CONSTRAINT goals_period_check CHECK (period IN ('month', 'week'))");

        Schema::create('timeline_events', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->string('type', 30);
            $table->string('title', 160);
            $table->string('description', 1000)->nullable();
            $table->date('occurred_on');
            $table->jsonb('metadata')->default('{}');
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();

            $table->index(['tenant_id', 'project_id', 'occurred_on']);
        });

        foreach (['goals', 'timeline_events'] as $table) {
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

        // Avaliação diária das metas de todas as agências: só ids (padrão da ADR 0012).
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.tenants_with_active_goals()
                RETURNS TABLE (tenant_id uuid)
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$ SELECT DISTINCT g.tenant_id FROM public.goals g WHERE g.active $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION app.tenants_with_active_goals() FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION app.tenants_with_active_goals() TO delta_app');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS app.tenants_with_active_goals()');
        Schema::dropIfExists('timeline_events');
        Schema::dropIfExists('goals');
    }
};
