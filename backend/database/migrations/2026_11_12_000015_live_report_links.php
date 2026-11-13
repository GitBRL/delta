<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Dashboards ao vivo (ADR 0016): o link público pode apontar para uma versão publicada
 * (números congelados) OU para o relatório em si (recalculado a cada acesso, com cache curto).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('share_links', function (Blueprint $table) {
            $table->uuid('snapshot_id')->nullable()->change();
            $table->foreignUuid('report_id')->nullable()->after('snapshot_id')->constrained()->cascadeOnDelete();
        });
        DB::statement('ALTER TABLE share_links ADD CONSTRAINT share_links_target_check CHECK ((snapshot_id IS NULL) <> (report_id IS NULL))');

        // Agora também devolve o relatório ao vivo; os dados dele são calculados na aplicação,
        // no contexto da agência dona do link (o hash do token já provou o acesso).
        DB::statement('DROP FUNCTION IF EXISTS app.shared_report(text)');
        DB::statement(<<<'SQL'
            CREATE FUNCTION app.shared_report(p_token_hash text)
                RETURNS TABLE (
                    link_id uuid, snapshot_id uuid, report_id uuid, tenant_id uuid, tenant_name text, title text, data jsonb,
                    pdf_status text, pdf_path text, password_hash text,
                    expires_at timestamptz, revoked_at timestamptz, created_at timestamptz
                )
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    SELECT l.id, s.id, r.id, l.tenant_id, t.name::text, COALESCE(s.title, r.title)::text, s.data,
                           s.pdf_status::text, s.pdf_path::text, l.password_hash::text,
                           l.expires_at, l.revoked_at, COALESCE(s.created_at, l.created_at)
                    FROM public.share_links l
                    LEFT JOIN public.report_snapshots s ON s.id = l.snapshot_id
                    LEFT JOIN public.reports r ON r.id = l.report_id
                    JOIN public.tenants t ON t.id = l.tenant_id
                    WHERE l.token_hash = p_token_hash
                    LIMIT 1
                $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION app.shared_report(text) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION app.shared_report(text) TO delta_app');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE share_links DROP CONSTRAINT IF EXISTS share_links_target_check');
        Schema::table('share_links', function (Blueprint $table) {
            $table->dropConstrainedForeignId('report_id');
        });
    }
};
