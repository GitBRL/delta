<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Gestão de Meta Ads (ADR 0030): registro de cada mudança (quem, o quê, antes e depois) e os
 * objetos das contas em demonstração (para pausar e ajustar orçamento sem chamar a Meta).
 * Só a equipe da agência.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ad_changes', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('account_id')->nullable()->constrained('integration_accounts')->nullOnDelete();
            $table->foreignUuid('project_id')->nullable()->constrained()->nullOnDelete();
            $table->string('level', 10);
            $table->string('object_id', 60);
            $table->string('object_name', 255);
            $table->string('action', 10);
            $table->jsonb('before');
            $table->jsonb('after');
            $table->string('status', 10);
            $table->string('error', 500)->nullable();
            $table->string('idempotency_key', 80)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['tenant_id', 'idempotency_key']);
            $table->index(['tenant_id', 'account_id', 'created_at']);
        });
        DB::statement("ALTER TABLE ad_changes ADD CONSTRAINT ad_changes_level_check CHECK (level IN ('campaign', 'adset'))");
        DB::statement("ALTER TABLE ad_changes ADD CONSTRAINT ad_changes_action_check CHECK (action IN ('pause', 'activate', 'budget'))");
        DB::statement("ALTER TABLE ad_changes ADD CONSTRAINT ad_changes_status_check CHECK (status IN ('applied', 'failed'))");

        Schema::create('sandbox_ad_objects', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('account_id')->constrained('integration_accounts')->cascadeOnDelete();
            $table->string('external_id', 60);
            $table->string('level', 10);
            $table->string('parent_external_id', 60)->nullable();
            $table->string('name', 255);
            $table->string('status', 10);
            $table->string('objective', 40)->nullable();
            $table->decimal('daily_budget', 12, 2)->nullable();
            $table->timestampsTz();
            $table->unique(['account_id', 'external_id']);
        });

        foreach (['ad_changes', 'sandbox_ad_objects'] as $table) {
            Rls::tenantIsolation($table);
            DB::statement("CREATE POLICY {$table}_staff ON {$table} AS RESTRICTIVE USING ((SELECT app.is_staff())) WITH CHECK ((SELECT app.is_staff()))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('sandbox_ad_objects');
        Schema::dropIfExists('ad_changes');
    }
};
