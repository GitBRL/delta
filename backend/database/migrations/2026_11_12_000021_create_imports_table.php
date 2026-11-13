<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Importações de outras ferramentas (Reportei). O token de origem NÃO é guardado. ADR 0022. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('imports', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('source', 20);
            $table->string('status', 10); // queued | running | done | failed
            $table->jsonb('summary')->default('{}');
            $table->string('error', 300)->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
        });

        Rls::tenantIsolation('imports');
        DB::statement('CREATE POLICY imports_admin_only ON imports AS RESTRICTIVE USING ((SELECT app.is_tenant_admin() OR app.current_user_id() IS NULL)) WITH CHECK ((SELECT app.is_tenant_admin() OR app.current_user_id() IS NULL))');
    }

    public function down(): void
    {
        Schema::dropIfExists('imports');
    }
};
