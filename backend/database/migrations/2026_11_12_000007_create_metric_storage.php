<?php

declare(strict_types=1);

use App\Domain\Metrics\Storage\FactPartitions;
use App\Support\Database\Rls;
use Carbon\CarbonImmutable;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Armazenamento de métricas.
 *
 *  metric_facts_daily   valor diário de cada métrica armazenada (aditivas, snapshots e o valor
 *                       diário das não aditivas, usado nos gráficos). Particionada por mês.
 *  metric_period_values valor de métricas NÃO aditivas para um período exato (alcance, usuários
 *                       únicos): não pode ser obtido somando os dias, vem da plataforma.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE TABLE metric_facts_daily (
                tenant_id              uuid          NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
                integration_account_id uuid          NOT NULL REFERENCES integration_accounts (id) ON DELETE CASCADE,
                metric_key             varchar(80)   NOT NULL,
                date                   date          NOT NULL,
                value                  numeric(20,6) NOT NULL,
                synced_at              timestamptz   NOT NULL DEFAULT now(),
                PRIMARY KEY (integration_account_id, metric_key, date)
            ) PARTITION BY RANGE (date)
        SQL);
        DB::statement('CREATE INDEX metric_facts_daily_tenant_idx ON metric_facts_daily (tenant_id, date)');
        Rls::tenantIsolation('metric_facts_daily');

        // Linhas fora das partições mensais caem aqui em vez de falhar; o comando
        // metrics:partitions cria as partições à frente e este destino deve ficar vazio.
        DB::statement('CREATE TABLE metric_facts_daily_default PARTITION OF metric_facts_daily DEFAULT');
        DB::statement('REVOKE ALL ON TABLE metric_facts_daily_default FROM delta_app, delta_readonly');

        $today = CarbonImmutable::now();
        FactPartitions::ensure(DB::connection(), $today->subMonths(26), $today->addMonths(12));

        Schema::create('metric_period_values', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('integration_account_id')->constrained()->cascadeOnDelete();
            $table->string('metric_key', 80);
            $table->date('start_date');
            $table->date('end_date');
            $table->decimal('value', 20, 6)->nullable();
            $table->timestampTz('fetched_at');

            $table->unique(['integration_account_id', 'metric_key', 'start_date', 'end_date']);
        });
        Rls::tenantIsolation('metric_period_values');
    }

    public function down(): void
    {
        Schema::dropIfExists('metric_period_values');
        DB::statement('DROP TABLE IF EXISTS metric_facts_daily CASCADE');
    }
};
