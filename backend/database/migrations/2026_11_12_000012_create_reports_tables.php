<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Relatórios (ADR 0011):
 *  - reports:          rascunho editável (layout JSONB de seções e blocos) por projeto;
 *  - report_snapshots: versão publicada, com os números congelados. Imutável: a aplicação só
 *                      consegue atualizar as colunas do PDF (privilégio por coluna);
 *  - share_links:      link público de um snapshot (hash do token, validade e senha opcionais).
 *
 * RLS: isolamento por agência; o papel cliente só enxerga relatórios dos projetos dos quais
 * é membro e não grava nada; links públicos são só da equipe. O acesso público passa por
 * funções estreitas (busca exata pelo hash do token).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reports', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->string('title', 120);
            $table->string('template', 40)->nullable();
            $table->string('period_preset', 20);
            $table->date('period_start')->nullable();
            $table->date('period_end')->nullable();
            $table->string('compare', 20);
            $table->jsonb('layout');
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestampsTz();

            $table->index(['tenant_id', 'project_id']);
        });

        Schema::create('report_snapshots', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('report_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->string('title', 120);
            $table->date('period_start');
            $table->date('period_end');
            $table->date('compare_start')->nullable();
            $table->date('compare_end')->nullable();
            $table->jsonb('data');
            $table->string('pdf_status', 10)->default('pending');
            $table->string('pdf_path', 300)->nullable();
            $table->string('pdf_error', 300)->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->index(['tenant_id', 'report_id', 'created_at']);
            $table->index(['tenant_id', 'project_id', 'created_at']);
        });
        DB::statement("ALTER TABLE report_snapshots ADD CONSTRAINT report_snapshots_pdf_status_check CHECK (pdf_status IN ('pending', 'ready', 'failed'))");

        Schema::create('share_links', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('snapshot_id')->constrained('report_snapshots')->cascadeOnDelete();
            $table->char('token_hash', 64)->unique();
            $table->string('password_hash')->nullable();
            $table->timestampTz('expires_at')->nullable();
            $table->timestampTz('revoked_at')->nullable();
            $table->unsignedInteger('view_count')->default(0);
            $table->timestampTz('last_viewed_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
        });

        foreach (['reports', 'report_snapshots', 'share_links'] as $table) {
            Rls::tenantIsolation($table);
        }

        // Cliente: só relatórios dos próprios projetos. Escrita: só a equipe.
        foreach (['reports', 'report_snapshots'] as $table) {
            DB::statement(<<<SQL
                CREATE POLICY {$table}_client_scope ON {$table} AS RESTRICTIVE FOR SELECT
                    USING (
                        (SELECT app.is_staff())
                        OR EXISTS (
                            SELECT 1 FROM project_members pm
                            WHERE pm.project_id = {$table}.project_id AND pm.user_id = (SELECT app.current_user_id())
                        )
                    )
            SQL);
            DB::statement("CREATE POLICY {$table}_staff_insert ON {$table} AS RESTRICTIVE FOR INSERT WITH CHECK ((SELECT app.is_staff()))");
            DB::statement("CREATE POLICY {$table}_staff_update ON {$table} AS RESTRICTIVE FOR UPDATE USING ((SELECT app.is_staff())) WITH CHECK ((SELECT app.is_staff()))");
            DB::statement("CREATE POLICY {$table}_staff_delete ON {$table} AS RESTRICTIVE FOR DELETE USING ((SELECT app.is_staff()))");
        }
        DB::statement('CREATE POLICY share_links_staff_only ON share_links AS RESTRICTIVE USING ((SELECT app.is_staff())) WITH CHECK ((SELECT app.is_staff()))');

        // Snapshot imutável: a aplicação só atualiza o estado do PDF.
        DB::statement('REVOKE UPDATE ON report_snapshots FROM delta_app');
        DB::statement('GRANT UPDATE (pdf_status, pdf_path, pdf_error, updated_at) ON report_snapshots TO delta_app');

        // Acesso público por link: busca exata pelo hash, sem contexto de agência (ADR 0011).
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.shared_report(p_token_hash text)
                RETURNS TABLE (
                    snapshot_id uuid, tenant_id uuid, tenant_name text, title text, data jsonb,
                    pdf_status text, pdf_path text, password_hash text,
                    expires_at timestamptz, revoked_at timestamptz, created_at timestamptz
                )
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    SELECT s.id, s.tenant_id, t.name::text, s.title::text, s.data,
                           s.pdf_status::text, s.pdf_path::text, l.password_hash::text,
                           l.expires_at, l.revoked_at, s.created_at
                    FROM public.share_links l
                    JOIN public.report_snapshots s ON s.id = l.snapshot_id
                    JOIN public.tenants t ON t.id = s.tenant_id
                    WHERE l.token_hash = p_token_hash
                    LIMIT 1
                $$
        SQL);
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.count_report_view(p_token_hash text)
                RETURNS void
                LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    UPDATE public.share_links
                    SET view_count = view_count + 1, last_viewed_at = now()
                    WHERE token_hash = p_token_hash AND revoked_at IS NULL
                      AND (expires_at IS NULL OR expires_at > now())
                $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION app.shared_report(text), app.count_report_view(text) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION app.shared_report(text), app.count_report_view(text) TO delta_app');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS app.count_report_view(text)');
        DB::statement('DROP FUNCTION IF EXISTS app.shared_report(text)');
        Schema::dropIfExists('share_links');
        Schema::dropIfExists('report_snapshots');
        Schema::dropIfExists('reports');
    }
};
