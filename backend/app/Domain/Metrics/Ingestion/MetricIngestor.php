<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Ingestion;

use App\Domain\Integrations\ConnectorRegistry;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricKind;
use App\Models\IntegrationConnection;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Grava os valores diários vindos de um conector em metric_facts_daily (upsert idempotente:
 * sincronizar o mesmo período de novo só atualiza os valores).
 *
 * Roda sempre dentro do contexto da agência (job com TenantScopedJob): o RLS garante que uma
 * sincronização nunca escreve em conta de outra agência.
 */
final readonly class MetricIngestor
{
    private const CHUNK = 1000;

    public function __construct(
        private ConnectorRegistry $connectors,
        private Catalog $catalog,
    ) {}

    /** @return int linhas gravadas */
    public function sync(IntegrationConnection $connection, CarbonImmutable $from, CarbonImmutable $to): int
    {
        $connector = $this->connectors->for($connection);
        $written = 0;

        foreach ($connection->accounts()->get() as $account) {
            $buffer = [];

            foreach ($connector->fetchDaily($account, $from, $to) as $row) {
                $metric = $this->catalog->metric($row['metric']);

                // Só métricas conhecidas e armazenáveis; derivadas são sempre calculadas na consulta.
                if ($metric === null || $metric->kind === MetricKind::Derived || $metric->provider() !== $account->provider) {
                    continue;
                }

                $buffer[] = [
                    'tenant_id' => $account->tenant_id,
                    'integration_account_id' => $account->id,
                    'metric_key' => $row['metric'],
                    'date' => $row['date'],
                    'value' => $row['value'],
                    'synced_at' => now(),
                ];

                if (count($buffer) >= self::CHUNK) {
                    $written += $this->flush($buffer);
                    $buffer = [];
                }
            }

            $written += $this->flush($buffer);

            // Valores de período em cache ficam obsoletos quando os dias de origem mudam.
            DB::table('metric_period_values')
                ->where('integration_account_id', $account->id)
                ->where('end_date', '>=', $from->toDateString())
                ->where('start_date', '<=', $to->toDateString())
                ->delete();
        }

        return $written;
    }

    /** @param list<array<string, mixed>> $rows */
    private function flush(array $rows): int
    {
        if ($rows === []) {
            return 0;
        }

        DB::table('metric_facts_daily')->upsert(
            $rows,
            ['integration_account_id', 'metric_key', 'date'],
            ['value', 'synced_at'],
        );

        return count($rows);
    }
}
