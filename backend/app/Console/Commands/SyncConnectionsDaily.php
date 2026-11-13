<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\ConnectorRegistry;
use App\Models\IntegrationConnection;
use App\Support\Tenancy\TenantContext;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Madrugada: ressincroniza os últimos dias de todas as conexões (conversões atribuídas com
 * atraso mudam os números recentes). Listagem entre agências só de ids; o resto, sob RLS (ADR 0012).
 */
#[Signature('connections:sync-daily')]
#[Description('Sincroniza diariamente as conexões de todas as agências')]
final class SyncConnectionsDaily extends Command
{
    public function handle(TenantContext $context, ConnectionManager $manager, ConnectorRegistry $connectors): int
    {
        /** @var list<object{tenant_id: string, connection_id: string}> $rows */
        $rows = DB::select('select * from app.connections_for_daily_sync()');
        $synced = 0;

        foreach ($rows as $row) {
            $context->run($row->tenant_id, null, function () use ($row, $manager, $connectors, &$synced): void {
                $connection = IntegrationConnection::query()->find($row->connection_id);
                if ($connection !== null && ! ConnectionManager::isDestination($connection->provider) && ($connection->isSandbox() || $connectors->hasLiveConnector($connection->provider))) {
                    $manager->resync($connection);
                    $synced++;
                }
            });
        }

        $this->info("{$synced} conexão(ões) em sincronização.");

        return self::SUCCESS;
    }
}
