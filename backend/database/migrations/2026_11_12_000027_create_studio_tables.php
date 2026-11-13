<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Studio (ADR 0029): apresentações geradas por IA com os dados do projeto. Cada pedido de
 * ajuste vira uma versão nova (dá para voltar). Só a equipe da agência.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('presentations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->string('title', 160);
            $table->text('brief');
            $table->string('format', 10);
            $table->string('period_preset', 20);
            $table->date('period_start')->nullable();
            $table->date('period_end')->nullable();
            $table->string('compare', 20);
            $table->string('status', 12)->default('generating');
            $table->string('error', 500)->nullable();
            $table->unsignedInteger('current_version')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->index(['tenant_id', 'project_id', 'created_at']);
        });
        DB::statement("ALTER TABLE presentations ADD CONSTRAINT presentations_format_check CHECK (format IN ('slides', 'page'))");
        DB::statement("ALTER TABLE presentations ADD CONSTRAINT presentations_status_check CHECK (status IN ('generating', 'ready', 'error'))");

        Schema::create('presentation_versions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('presentation_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('number');
            $table->text('instruction');
            $table->jsonb('spec');
            $table->jsonb('layout');
            $table->jsonb('rendered');
            $table->jsonb('unverified_numbers')->default('[]');
            $table->string('model', 60);
            $table->unsignedInteger('input_tokens')->default(0);
            $table->unsignedInteger('output_tokens')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['presentation_id', 'number']);
        });

        foreach (['presentations', 'presentation_versions'] as $table) {
            Rls::tenantIsolation($table);
            DB::statement("CREATE POLICY {$table}_staff ON {$table} AS RESTRICTIVE USING ((SELECT app.is_staff())) WITH CHECK ((SELECT app.is_staff()))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('presentation_versions');
        Schema::dropIfExists('presentations');
    }
};
