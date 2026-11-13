<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Indicadores personalizados de cada agência (§7.1 do plano): fórmulas sobre métricas do
 * catálogo e sobre outros indicadores. A chave (custom:slug) é imutável depois de criada,
 * porque outras fórmulas e relatórios a referenciam.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('custom_metrics', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('key', 80);
            $table->string('name', 80);
            $table->string('description', 500)->nullable();
            $table->string('formula', 500);
            $table->jsonb('references')->default('[]');
            $table->string('unit', 10);
            $table->string('direction', 20);
            $table->unsignedSmallInteger('decimals')->default(2);
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();

            $table->unique(['tenant_id', 'key']);
        });

        Rls::tenantIsolation('custom_metrics');
    }

    public function down(): void
    {
        Schema::dropIfExists('custom_metrics');
    }
};
