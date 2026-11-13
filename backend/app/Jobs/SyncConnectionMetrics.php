<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Domain\Integrations\ConnectorUnavailable;
use App\Domain\Integrations\Live\LiveApiException;
use App\Domain\Metrics\Ingestion\MetricIngestor;
use App\Domain\Webhooks\Webhooks;
use App\Models\IntegrationConnection;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantScopedJob;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Sincroniza as métricas diárias de todas as contas de uma conexão em um intervalo de datas.
 * Roda no contexto da agência capturado no dispatch (TenantScopedJob).
 */
final class SyncConnectionMetrics implements ShouldBeUnique, ShouldQueue
{
    use Queueable, TenantScopedJob;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [10, 60, 300];

    public int $uniqueFor = 900;

    public function __construct(
        public readonly string $connectionId,
        public readonly string $from,
        public readonly string $to,
    ) {
        $this->captureTenantContext();
        $this->onQueue('metrics');
    }

    public function uniqueId(): string
    {
        return "{$this->connectionId}:{$this->from}:{$this->to}";
    }

    public function handle(MetricIngestor $ingestor): void
    {
        $connection = IntegrationConnection::query()->findOrFail($this->connectionId);
        $runId = (string) Str::uuid7();

        DB::table('sync_runs')->insert([
            'id' => $runId,
            'connection_id' => $connection->id,
            'status' => 'running',
            'from_date' => $this->from,
            'to_date' => $this->to,
            'started_at' => now(),
        ]);

        try {
            $rows = $ingestor->sync($connection, CarbonImmutable::parse($this->from), CarbonImmutable::parse($this->to));
        } catch (ConnectorUnavailable|LiveApiException $e) {
            if ($e instanceof LiveApiException && $e->retryable) {
                DB::table('sync_runs')->where('id', $runId)->update(['status' => 'failed', 'finished_at' => now()]);

                throw $e; // rede ou limite de chamadas: nova tentativa com backoff
            }

            // Definitivo: token expirado/revogado ou consulta recusada. Não adianta tentar de novo.
            DB::table('sync_runs')->where('id', $runId)->update(['status' => 'failed', 'finished_at' => now()]);
            $expired = $e instanceof ConnectorUnavailable && str_contains($e->getMessage(), 'Reconecte');
            $connection->refresh()->forceFill([
                'status' => $expired ? 'expired' : 'error',
                'last_error' => mb_substr($e->getMessage(), 0, 500),
            ])->save();
            if ($expired) {
                Webhooks::emit('connection.expired', ['connection_id' => $connection->id, 'provider' => $connection->provider, 'label' => $connection->label]);
            }

            return;
        }

        DB::table('sync_runs')->where('id', $runId)->update([
            'status' => 'done',
            'rows_written' => $rows,
            'finished_at' => now(),
        ]);

        $connection->forceFill([
            'status' => 'active',
            'last_synced_at' => now(),
            'last_error' => null,
        ])->save();
    }

    /** Chamado pelo worker após a última tentativa, fora do middleware: restaura o contexto. */
    public function failed(?Throwable $exception): void
    {
        app(TenantContext::class)->run((string) $this->tenantId, $this->actingUserId, function () use ($exception): void {
            IntegrationConnection::query()->whereKey($this->connectionId)->where('status', '!=', 'expired')->update([
                'status' => 'error',
                'last_error' => mb_substr($exception?->getMessage() ?? 'Falha na sincronização.', 0, 500),
            ]);
        });
    }
}
