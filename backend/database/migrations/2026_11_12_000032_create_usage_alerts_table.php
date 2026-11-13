<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Avisos de franquia já enviados (um por limite, limiar e mês). ADR 0031. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('usage_alerts', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('metric', 30);
            $table->unsignedSmallInteger('threshold');
            $table->char('period', 7);
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['tenant_id', 'metric', 'threshold', 'period']);
        });

        Rls::tenantIsolation('usage_alerts');
        DB::statement('CREATE POLICY usage_alerts_system ON usage_alerts AS RESTRICTIVE USING ((SELECT app.current_user_id()) IS NULL OR (SELECT app.is_tenant_admin())) WITH CHECK ((SELECT app.current_user_id()) IS NULL)');
    }

    public function down(): void
    {
        Schema::dropIfExists('usage_alerts');
    }
};
