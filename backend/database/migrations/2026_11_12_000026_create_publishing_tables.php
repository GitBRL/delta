<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Publishing (ADR 0028): biblioteca de mídia, posts por projeto, destinos por rede e aprovação
 * do cliente por link. O cliente final lê só o que é dos projetos dele; só a equipe grava.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('media_assets', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('kind', 10);
            $table->string('path', 300);
            $table->string('original_name', 255);
            $table->string('mime', 60);
            $table->unsignedBigInteger('size_bytes');
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            $table->string('checksum', 64);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->index(['tenant_id', 'project_id', 'created_at']);
        });
        DB::statement("ALTER TABLE media_assets ADD CONSTRAINT media_assets_kind_check CHECK (kind IN ('image', 'video'))");

        Schema::create('posts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->string('title', 120)->nullable();
            $table->text('caption')->default('');
            $table->jsonb('media')->default('[]');
            $table->string('status', 20)->default('draft');
            $table->boolean('requires_approval')->default(true);
            $table->timestampTz('scheduled_at')->nullable();
            $table->timestampTz('published_at')->nullable();
            $table->string('external_reference', 100)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'external_reference']);
            $table->index(['tenant_id', 'project_id', 'scheduled_at']);
        });
        DB::statement("ALTER TABLE posts ADD CONSTRAINT posts_status_check CHECK (status IN ('draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'))");

        Schema::create('post_targets', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('post_id')->constrained()->cascadeOnDelete();
            $table->string('network', 20);
            $table->string('format', 20);
            $table->foreignUuid('account_id')->nullable()->constrained('integration_accounts')->nullOnDelete();
            $table->string('status', 12)->default('pending');
            $table->string('external_id', 200)->nullable();
            $table->string('permalink', 500)->nullable();
            $table->string('error', 500)->nullable();
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestampTz('published_at')->nullable();
            $table->jsonb('options')->default('{}');
            $table->timestampsTz();
            $table->index(['tenant_id', 'post_id']);
        });
        DB::statement("ALTER TABLE post_targets ADD CONSTRAINT post_targets_network_check CHECK (network IN ('instagram', 'facebook', 'youtube'))");
        DB::statement("ALTER TABLE post_targets ADD CONSTRAINT post_targets_status_check CHECK (status IN ('pending', 'publishing', 'published', 'failed'))");

        Schema::create('post_approvals', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('post_id')->constrained()->cascadeOnDelete();
            $table->string('token_hash', 64)->unique();
            $table->text('token');
            $table->foreignUuid('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('expires_at');
            $table->timestampTz('decided_at')->nullable();
            $table->string('decision', 20)->nullable();
            $table->text('comment')->nullable();
            $table->string('decided_by_name', 120)->nullable();
            $table->jsonb('notified')->default('{}');
            $table->timestampsTz();
            $table->index(['tenant_id', 'post_id']);
        });
        DB::statement("ALTER TABLE post_approvals ADD CONSTRAINT post_approvals_decision_check CHECK (decision IS NULL OR decision IN ('approved', 'changes_requested'))");

        // Mídia e posts: cliente lê os dos projetos dele; equipe grava (mesmo padrão de metas e linha do tempo).
        foreach (['media_assets' => 'media_assets.project_id', 'posts' => 'posts.project_id'] as $table => $projectColumn) {
            Rls::tenantIsolation($table);
            DB::statement(<<<SQL
                CREATE POLICY {$table}_client_scope ON {$table} AS RESTRICTIVE FOR SELECT
                    USING (
                        (SELECT app.is_staff())
                        OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = {$projectColumn} AND pm.user_id = (SELECT app.current_user_id()))
                    )
            SQL);
            self::staffWrites($table);
        }

        Rls::tenantIsolation('post_targets');
        DB::statement(<<<'SQL'
            CREATE POLICY post_targets_client_scope ON post_targets AS RESTRICTIVE FOR SELECT
                USING (
                    (SELECT app.is_staff())
                    OR EXISTS (
                        SELECT 1 FROM posts p JOIN project_members pm ON pm.project_id = p.project_id
                        WHERE p.id = post_targets.post_id AND pm.user_id = (SELECT app.current_user_id())
                    )
                )
        SQL);
        self::staffWrites('post_targets');

        // Pedidos de aprovação (com o token cifrado): só a equipe.
        Rls::tenantIsolation('post_approvals');
        DB::statement('CREATE POLICY post_approvals_staff ON post_approvals AS RESTRICTIVE USING ((SELECT app.is_staff())) WITH CHECK ((SELECT app.is_staff()))');

        // Agendador: posts vencidos de todas as agências, só ids (padrão da ADR 0012). Inclui os
        // presos em "publicando" há 30 min (queda do worker): a publicação trata esses destinos.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.due_posts(p_now timestamptz)
                RETURNS TABLE (tenant_id uuid, post_id uuid)
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    SELECT p.tenant_id, p.id FROM public.posts p
                    WHERE (p.status = 'scheduled' AND p.scheduled_at <= p_now)
                       OR (p.status = 'publishing' AND p.updated_at < p_now - interval '30 minutes')
                $$
        SQL);

        // Página pública de aprovação: busca exata pelo hash do token (ADR 0028), sem dados do post.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.post_approval_by_token(p_token_hash text)
                RETURNS TABLE (approval_id uuid, tenant_id uuid, post_id uuid, expires_at timestamptz, decided_at timestamptz)
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$ SELECT a.id, a.tenant_id, a.post_id, a.expires_at, a.decided_at FROM public.post_approvals a WHERE a.token_hash = p_token_hash LIMIT 1 $$
        SQL);

        DB::statement('REVOKE ALL ON FUNCTION app.due_posts(timestamptz), app.post_approval_by_token(text) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION app.due_posts(timestamptz), app.post_approval_by_token(text) TO delta_app');
    }

    private static function staffWrites(string $table): void
    {
        DB::statement("CREATE POLICY {$table}_staff_insert ON {$table} AS RESTRICTIVE FOR INSERT WITH CHECK ((SELECT app.is_staff()))");
        DB::statement("CREATE POLICY {$table}_staff_update ON {$table} AS RESTRICTIVE FOR UPDATE USING ((SELECT app.is_staff())) WITH CHECK ((SELECT app.is_staff()))");
        DB::statement("CREATE POLICY {$table}_staff_delete ON {$table} AS RESTRICTIVE FOR DELETE USING ((SELECT app.is_staff()))");
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS app.post_approval_by_token(text)');
        DB::statement('DROP FUNCTION IF EXISTS app.due_posts(timestamptz)');
        Schema::dropIfExists('post_approvals');
        Schema::dropIfExists('post_targets');
        Schema::dropIfExists('posts');
        Schema::dropIfExists('media_assets');
    }
};
