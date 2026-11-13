<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * API pública v1 (tokens por agência, com escopos) e webhooks de saída. ADR 0020.
 * Só dono e administrador gerenciam tokens e webhooks (também no banco).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('api_tokens', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            $table->string('token_prefix', 12);
            $table->char('token_hash', 64)->unique();
            $table->jsonb('scopes');
            $table->timestampTz('last_used_at')->nullable();
            $table->timestampTz('expires_at')->nullable();
            $table->timestampTz('revoked_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
        });

        Schema::create('webhook_endpoints', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('url', 500);
            $table->string('description', 120)->nullable();
            $table->text('secret'); // criptografado (APP_KEY); assina as entregas
            $table->jsonb('events');
            $table->boolean('active')->default(true);
            $table->unsignedInteger('failure_count')->default(0);
            $table->timestampTz('disabled_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
        });

        Schema::create('webhook_deliveries', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('endpoint_id')->constrained('webhook_endpoints')->cascadeOnDelete();
            $table->string('event', 60);
            $table->jsonb('payload');
            $table->string('status', 10)->default('pending'); // pending | delivered | failed
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->unsignedSmallInteger('last_status_code')->nullable();
            $table->string('last_error', 300)->nullable();
            $table->timestampTz('delivered_at')->nullable();
            $table->timestampsTz();

            $table->index(['tenant_id', 'endpoint_id', 'created_at']);
        });

        foreach (['api_tokens', 'webhook_endpoints', 'webhook_deliveries'] as $table) {
            Rls::tenantIsolation($table);
            DB::statement("CREATE POLICY {$table}_admin_only ON {$table} AS RESTRICTIVE USING ((SELECT app.is_tenant_admin() OR app.current_user_id() IS NULL)) WITH CHECK ((SELECT app.is_tenant_admin() OR app.current_user_id() IS NULL))");
        }

        // Autenticação da API: busca exata pelo hash do token, antes de existir contexto (ADR 0002).
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.api_token_lookup(p_token_hash text)
                RETURNS TABLE (token_id uuid, tenant_id uuid, scopes jsonb, expires_at timestamptz, revoked_at timestamptz)
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    SELECT t.id, t.tenant_id, t.scopes, t.expires_at, t.revoked_at
                    FROM public.api_tokens t WHERE t.token_hash = p_token_hash LIMIT 1
                $$
        SQL);
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app.touch_api_token(p_token_id uuid)
                RETURNS void
                LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
                AS $$
                    UPDATE public.api_tokens SET last_used_at = now()
                    WHERE id = p_token_id AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')
                $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION app.api_token_lookup(text), app.touch_api_token(uuid) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION app.api_token_lookup(text), app.touch_api_token(uuid) TO delta_app');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS app.touch_api_token(uuid)');
        DB::statement('DROP FUNCTION IF EXISTS app.api_token_lookup(text)');
        Schema::dropIfExists('webhook_deliveries');
        Schema::dropIfExists('webhook_endpoints');
        Schema::dropIfExists('api_tokens');
    }
};
