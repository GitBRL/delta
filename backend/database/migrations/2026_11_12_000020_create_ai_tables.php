<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Copiloto de IA (ADR 0021): chave do provedor por agência (dono/admin), orçamento mensal de
 * tokens e registro de uso (append-only).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_settings', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->unique()->constrained()->cascadeOnDelete();
            $table->text('api_key')->nullable(); // criptografada (APP_KEY)
            $table->boolean('enabled')->default(true);
            $table->unsignedInteger('monthly_token_budget')->default(2_000_000);
            $table->uuid('updated_by')->nullable();
            $table->timestampsTz();
        });

        Schema::create('ai_usage', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('feature', 30);
            $table->unsignedInteger('input_tokens');
            $table->unsignedInteger('output_tokens');
            $table->uuid('user_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['tenant_id', 'created_at']);
        });

        foreach (['ai_settings', 'ai_usage'] as $table) {
            Rls::tenantIsolation($table);
            DB::statement("CREATE POLICY {$table}_staff_only ON {$table} AS RESTRICTIVE USING ((SELECT app.is_staff())) WITH CHECK ((SELECT app.is_staff()))");
        }
        foreach (['INSERT' => 'WITH CHECK', 'UPDATE' => 'USING', 'DELETE' => 'USING'] as $command => $clause) {
            $extra = $command === 'UPDATE' ? ' WITH CHECK ((SELECT app.is_tenant_admin()))' : '';
            DB::statement('CREATE POLICY ai_settings_admin_'.strtolower($command)." ON ai_settings AS RESTRICTIVE FOR {$command} {$clause} ((SELECT app.is_tenant_admin())){$extra}");
        }
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON ai_usage FROM delta_app');
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_usage');
        Schema::dropIfExists('ai_settings');
    }
};
