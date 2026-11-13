<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Fonte manual de dados (ADR 0015): métricas definidas pela agência ("manual:vendas_loja") e
 * valores lançados por projeto e dia (digitados ou importados de planilha).
 *
 * Leitura: definições para toda a agência (o cliente precisa delas para ver os próprios
 * relatórios); valores com o mesmo escopo de cliente dos projetos. Escrita: só a equipe.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('manual_metrics', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('key', 80);
            $table->string('name', 80);
            $table->string('description', 300)->nullable();
            $table->string('unit', 20);
            $table->string('direction', 20);
            $table->unsignedSmallInteger('decimals')->default(0);
            $table->string('aggregation', 10); // sum | last
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();

            $table->unique(['tenant_id', 'key']);
        });
        DB::statement("ALTER TABLE manual_metrics ADD CONSTRAINT manual_metrics_aggregation_check CHECK (aggregation IN ('sum', 'last'))");

        Schema::create('manual_metric_values', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('manual_metric_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->decimal('value', 20, 6);
            $table->uuid('updated_by')->nullable();
            $table->timestampsTz();

            $table->unique(['manual_metric_id', 'project_id', 'date']);
            $table->index(['tenant_id', 'project_id', 'date']);
        });

        foreach (['manual_metrics', 'manual_metric_values'] as $table) {
            Rls::tenantIsolation($table);
            DB::statement("CREATE POLICY {$table}_staff_insert ON {$table} AS RESTRICTIVE FOR INSERT WITH CHECK ((SELECT app.is_staff()))");
            DB::statement("CREATE POLICY {$table}_staff_update ON {$table} AS RESTRICTIVE FOR UPDATE USING ((SELECT app.is_staff())) WITH CHECK ((SELECT app.is_staff()))");
            DB::statement("CREATE POLICY {$table}_staff_delete ON {$table} AS RESTRICTIVE FOR DELETE USING ((SELECT app.is_staff()))");
        }

        DB::statement(<<<'SQL'
            CREATE POLICY manual_metric_values_client_scope ON manual_metric_values AS RESTRICTIVE FOR SELECT
                USING (
                    (SELECT app.is_staff())
                    OR EXISTS (
                        SELECT 1 FROM project_members pm
                        WHERE pm.project_id = manual_metric_values.project_id AND pm.user_id = (SELECT app.current_user_id())
                    )
                )
        SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('manual_metric_values');
        Schema::dropIfExists('manual_metrics');
    }
};
