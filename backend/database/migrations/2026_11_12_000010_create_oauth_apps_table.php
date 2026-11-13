<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Credenciais dos apps OAuth (Meta, Google) cadastradas pela própria agência na tela
 * "Apps das plataformas". Têm precedência sobre as do servidor (.env). Ver ADR 0009.
 *
 * Camadas no banco, além do isolamento por agência:
 *  - RESTRICTIVE "só equipe": o papel cliente nem enxerga as linhas;
 *  - RESTRICTIVE de escrita: só dono e administrador inserem, alteram ou removem.
 * A chave secreta e o developer token são criptografados pela aplicação (APP_KEY).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('oauth_apps', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('vendor', 20);
            $table->string('client_id', 255);
            $table->text('client_secret');
            $table->text('developer_token')->nullable();
            $table->timestampTz('verified_at')->nullable();
            $table->string('verification_error', 300)->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestampsTz();

            $table->unique(['tenant_id', 'vendor']);
        });

        DB::statement("ALTER TABLE oauth_apps ADD CONSTRAINT oauth_apps_vendor_check CHECK (vendor IN ('meta', 'google'))");

        Rls::tenantIsolation('oauth_apps');

        // Dono ou administrador do tenant do contexto. Exige usuário no contexto: nenhum job
        // de sistema grava credenciais de app. SECURITY INVOKER (como app.is_staff): lê
        // tenant_user sob o RLS de quem chama, que sempre enxerga o próprio vínculo.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.is_tenant_admin() RETURNS boolean
                LANGUAGE sql STABLE
                AS $$
                    SELECT EXISTS (
                        SELECT 1 FROM public.tenant_user tu
                        WHERE tu.tenant_id = app.current_tenant()
                          AND tu.user_id = app.current_user_id()
                          AND tu.role IN ('owner', 'admin')
                    )
                $$
        SQL);
        DB::statement('GRANT EXECUTE ON FUNCTION app.is_tenant_admin() TO delta_app, delta_admin, delta_readonly');

        DB::statement(<<<'SQL'
            CREATE POLICY oauth_apps_staff_only ON oauth_apps AS RESTRICTIVE
                USING ((SELECT app.is_staff()))
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY oauth_apps_admin_insert ON oauth_apps AS RESTRICTIVE FOR INSERT
                WITH CHECK ((SELECT app.is_tenant_admin()))
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY oauth_apps_admin_update ON oauth_apps AS RESTRICTIVE FOR UPDATE
                USING ((SELECT app.is_tenant_admin()))
                WITH CHECK ((SELECT app.is_tenant_admin()))
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY oauth_apps_admin_delete ON oauth_apps AS RESTRICTIVE FOR DELETE
                USING ((SELECT app.is_tenant_admin()))
        SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('oauth_apps');
        DB::statement('DROP FUNCTION IF EXISTS app.is_tenant_admin()');
    }
};
