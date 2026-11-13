<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Assinatura da agência (ADR 0031). Pessoas só criam o teste grátis (no cadastro); trocar de
 * plano, ativar ou cancelar é coisa do sistema (webhook do provedor de pagamento ou comando
 * administrativo), sem usuário no contexto.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscriptions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('plan', 20);
            $table->string('status', 12);
            $table->timestampTz('trial_ends_at')->nullable();
            $table->timestampTz('current_period_ends_at')->nullable();
            $table->string('provider', 20)->default('manual');
            $table->string('provider_customer_id', 120)->nullable();
            $table->string('provider_subscription_id', 120)->nullable();
            $table->timestampTz('canceled_at')->nullable();
            $table->timestampsTz();
        });
        DB::statement("ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check CHECK (status IN ('trialing', 'active', 'past_due', 'canceled'))");

        Rls::tenantIsolation('subscriptions');
        DB::statement(<<<'SQL'
            CREATE POLICY subscriptions_insert ON subscriptions AS RESTRICTIVE FOR INSERT
                WITH CHECK ((SELECT app.current_user_id()) IS NULL OR (plan = 'trial' AND status = 'trialing'))
        SQL);
        DB::statement('CREATE POLICY subscriptions_update ON subscriptions AS RESTRICTIVE FOR UPDATE USING ((SELECT app.current_user_id()) IS NULL) WITH CHECK ((SELECT app.current_user_id()) IS NULL)');
        DB::statement('CREATE POLICY subscriptions_delete ON subscriptions AS RESTRICTIVE FOR DELETE USING ((SELECT app.current_user_id()) IS NULL)');
    }

    public function down(): void
    {
        Schema::dropIfExists('subscriptions');
    }
};
