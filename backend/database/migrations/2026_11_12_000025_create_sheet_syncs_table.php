<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Sync: exportação agendada das métricas de um projeto para uma planilha do Google. ADR 0027.
 * Só a equipe da agência vê e gerencia (o cliente final não). O destino é uma conexão
 * "google_sheets" (escopo drive.file: só arquivos criados pelo Delta).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sheet_syncs', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('connection_id')->constrained('connections')->cascadeOnDelete();
            $table->string('name', 120);
            $table->jsonb('metrics');
            $table->unsignedSmallInteger('days');
            $table->string('frequency', 10);
            $table->boolean('active')->default(true);
            $table->string('spreadsheet_id', 200)->nullable();
            $table->string('spreadsheet_url', 500)->nullable();
            $table->timestampTz('last_run_at')->nullable();
            $table->string('last_status', 10)->nullable();
            $table->string('last_error', 500)->nullable();
            $table->jsonb('last_preview')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->index(['tenant_id', 'project_id']);
        });

        DB::statement("ALTER TABLE sheet_syncs ADD CONSTRAINT sheet_syncs_frequency_check CHECK (frequency IN ('daily', 'weekly'))");
        DB::statement("ALTER TABLE sheet_syncs ADD CONSTRAINT sheet_syncs_status_check CHECK (last_status IS NULL OR last_status IN ('running', 'ok', 'error'))");
        DB::statement('ALTER TABLE sheet_syncs ADD CONSTRAINT sheet_syncs_days_check CHECK (days BETWEEN 7 AND 400)');

        Rls::tenantIsolation('sheet_syncs');
        DB::statement('CREATE POLICY sheet_syncs_staff ON sheet_syncs AS RESTRICTIVE USING ((SELECT app.is_staff())) WITH CHECK ((SELECT app.is_staff()))');

        // Agendador: exportações vencidas de todas as agências, só ids (padrão da ADR 0012).
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.due_sheet_syncs(p_now timestamptz)
                RETURNS TABLE (tenant_id uuid, sync_id uuid)
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    SELECT s.tenant_id, s.id FROM public.sheet_syncs s
                    WHERE s.active
                      AND (s.last_status IS DISTINCT FROM 'running' OR s.last_run_at < p_now - interval '1 hour')
                      AND (s.last_run_at IS NULL
                           OR s.last_run_at <= p_now - CASE s.frequency WHEN 'weekly' THEN interval '7 days' ELSE interval '1 day' END + interval '10 minutes')
                $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION app.due_sheet_syncs(timestamptz) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION app.due_sheet_syncs(timestamptz) TO delta_app');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS app.due_sheet_syncs(timestamptz)');
        Schema::dropIfExists('sheet_syncs');
    }
};
