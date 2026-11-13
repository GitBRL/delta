<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Convites para a equipe da agência. Ver ADR 0010.
 *
 * - Só dono e administrador enxergam e gerenciam convites (RESTRICTIVE + app.is_tenant_admin).
 * - O token vai só no e-mail; aqui fica o hash (sha256).
 * - Quem recebe o convite ainda não é membro: a prévia e o aceite passam por duas funções
 *   SECURITY DEFINER estreitas (busca exata pelo hash), no mesmo padrão do login (ADR 0002).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invitations', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('email');
            $table->string('role', 20);
            $table->jsonb('project_ids')->default('[]');
            $table->char('token_hash', 64)->unique();
            $table->uuid('invited_by')->nullable();
            $table->timestampTz('expires_at');
            $table->timestampTz('accepted_at')->nullable();
            $table->uuid('accepted_by')->nullable();
            $table->timestampTz('revoked_at')->nullable();
            $table->timestampsTz();
        });

        // O dono não é convidado: vira dono quem já é membro (promoção feita por outro dono).
        DB::statement("ALTER TABLE invitations ADD CONSTRAINT invitations_role_check CHECK (role IN ('admin', 'analyst', 'client'))");
        DB::statement('CREATE UNIQUE INDEX invitations_one_pending_per_email ON invitations (tenant_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL');

        Rls::tenantIsolation('invitations');
        DB::statement(<<<'SQL'
            CREATE POLICY invitations_admin_only ON invitations AS RESTRICTIVE
                USING ((SELECT app.is_tenant_admin()))
                WITH CHECK ((SELECT app.is_tenant_admin()))
        SQL);

        // Prévia para a página pública do convite: só o necessário para a pessoa decidir.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.invitation_preview(p_token_hash text)
                RETURNS TABLE (tenant_name text, email text, role text, inviter_name text, expires_at timestamptz, status text)
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    SELECT t.name::text, i.email::text, i.role::text, u.name::text, i.expires_at,
                           CASE
                               WHEN i.accepted_at IS NOT NULL THEN 'accepted'
                               WHEN i.revoked_at IS NOT NULL THEN 'revoked'
                               WHEN i.expires_at <= now() THEN 'expired'
                               ELSE 'pending'
                           END
                    FROM public.invitations i
                    JOIN public.tenants t ON t.id = i.tenant_id
                    LEFT JOIN public.users u ON u.id = i.invited_by
                    WHERE i.token_hash = p_token_hash
                    LIMIT 1
                $$
        SQL);

        // Aceite atômico pelo usuário do contexto (app.user_id), que precisa ter o e-mail do convite.
        // Devolve o tenant em que a pessoa entrou, ou NULL (inválido, expirado, usado ou e-mail diferente).
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.accept_invitation(p_token_hash text)
                RETURNS uuid
                LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                DECLARE
                    v_user uuid := app.current_user_id();
                    v_inv record;
                    v_email text;
                BEGIN
                    IF v_user IS NULL THEN
                        RETURN NULL;
                    END IF;

                    SELECT i.id, i.tenant_id, i.email, i.role, i.project_ids INTO v_inv
                    FROM public.invitations i
                    WHERE i.token_hash = p_token_hash
                      AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
                    FOR UPDATE;

                    IF NOT FOUND THEN
                        RETURN NULL;
                    END IF;

                    SELECT lower(u.email) INTO v_email FROM public.users u WHERE u.id = v_user;
                    IF v_email IS DISTINCT FROM lower(v_inv.email) THEN
                        RETURN NULL;
                    END IF;

                    -- Já membro: mantém o papel atual (convite não rebaixa nem promove ninguém).
                    INSERT INTO public.tenant_user (tenant_id, user_id, role, created_at, updated_at)
                    VALUES (v_inv.tenant_id, v_user, v_inv.role, now(), now())
                    ON CONFLICT (tenant_id, user_id) DO NOTHING;

                    INSERT INTO public.project_members (tenant_id, project_id, user_id, created_at, updated_at)
                    SELECT v_inv.tenant_id, p.id, v_user, now(), now()
                    FROM public.projects p
                    WHERE p.tenant_id = v_inv.tenant_id
                      AND p.id::text IN (SELECT jsonb_array_elements_text(v_inv.project_ids))
                    ON CONFLICT (project_id, user_id) DO NOTHING;

                    UPDATE public.invitations
                    SET accepted_at = now(), accepted_by = v_user, updated_at = now()
                    WHERE id = v_inv.id;

                    RETURN v_inv.tenant_id;
                END
                $$
        SQL);

        DB::statement('REVOKE ALL ON FUNCTION app.invitation_preview(text), app.accept_invitation(text) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION app.invitation_preview(text), app.accept_invitation(text) TO delta_app');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS app.accept_invitation(text)');
        DB::statement('DROP FUNCTION IF EXISTS app.invitation_preview(text)');
        Schema::dropIfExists('invitations');
    }
};
