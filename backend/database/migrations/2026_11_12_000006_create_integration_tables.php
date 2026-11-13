<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Conexões com plataformas (Meta, Google...), contas descobertas nelas e o vínculo das contas
 * com projetos. Tudo isolado por agência.
 *
 *  - connections.mode: sandbox (dados de demonstração) | live (API real, após aprovação)
 *  - connections.credentials: tokens OAuth, criptografados pela aplicação (cast encrypted)
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('connections', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('provider', 40);
            $table->string('mode', 10);
            $table->string('status', 10);
            $table->string('label');
            $table->text('credentials')->nullable();
            $table->uuid('connected_by')->nullable();
            $table->timestampTz('last_synced_at')->nullable();
            $table->string('last_error', 500)->nullable();
            $table->timestampsTz();

            $table->index(['tenant_id', 'provider']);
        });
        DB::statement("ALTER TABLE connections ADD CONSTRAINT connections_mode_check CHECK (mode IN ('sandbox', 'live'))");
        DB::statement("ALTER TABLE connections ADD CONSTRAINT connections_status_check CHECK (status IN ('active', 'syncing', 'error', 'expired'))");

        Schema::create('integration_accounts', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('connection_id')->constrained()->cascadeOnDelete();
            $table->string('provider', 40);
            $table->string('external_id');
            $table->string('name');
            $table->string('kind', 20);
            $table->string('currency', 3)->nullable();
            $table->string('timezone', 64)->nullable();
            $table->timestampsTz();

            $table->unique(['connection_id', 'external_id']);
            $table->index(['tenant_id', 'provider']);
        });

        Schema::create('project_accounts', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('integration_account_id')->constrained()->cascadeOnDelete();
            $table->timestampsTz();

            $table->unique(['project_id', 'integration_account_id']);
            $table->index('integration_account_id');
        });

        Schema::create('sync_runs', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('connection_id')->constrained()->cascadeOnDelete();
            $table->string('status', 10);
            $table->date('from_date');
            $table->date('to_date');
            $table->unsignedInteger('rows_written')->default(0);
            $table->string('error', 500)->nullable();
            $table->timestampTz('started_at');
            $table->timestampTz('finished_at')->nullable();

            $table->index(['connection_id', 'started_at']);
        });

        foreach (['connections', 'integration_accounts', 'project_accounts', 'sync_runs'] as $table) {
            Rls::tenantIsolation($table);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_runs');
        Schema::dropIfExists('project_accounts');
        Schema::dropIfExists('integration_accounts');
        Schema::dropIfExists('connections');
    }
};
