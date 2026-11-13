<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Log de auditoria append-only.
 *
 * A aplicação (delta_app) só pode INSERT. UPDATE, DELETE e TRUNCATE são revogados, então nem
 * um bug nem uma conta comprometida da aplicação consegue apagar rastros.
 * Eventos sem tenant (ex.: login) ficam com tenant_id NULL e só são visíveis ao delta_admin.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->nullable()->constrained()->nullOnDelete();
            $table->uuid('actor_user_id')->nullable();
            $table->string('action', 100);
            $table->string('subject_type', 100)->nullable();
            $table->uuid('subject_id')->nullable();
            $table->ipAddress('ip')->nullable();
            $table->string('user_agent', 500)->nullable();
            $table->jsonb('metadata')->default('{}');
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['tenant_id', 'created_at']);
            $table->index(['subject_type', 'subject_id']);
        });

        Rls::enable('audit_logs');
        DB::statement('ALTER TABLE audit_logs ALTER COLUMN tenant_id SET DEFAULT app.current_tenant()');
        DB::statement(<<<'SQL'
            CREATE POLICY audit_logs_select ON audit_logs FOR SELECT
                USING (tenant_id = (SELECT app.current_tenant()))
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
                WITH CHECK (tenant_id IS NOT DISTINCT FROM (SELECT app.current_tenant()))
        SQL);

        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM delta_app');
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
    }
};
