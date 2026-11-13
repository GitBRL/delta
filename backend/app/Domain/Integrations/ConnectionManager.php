<?php

declare(strict_types=1);

namespace App\Domain\Integrations;

use App\Domain\Integrations\OAuth\OAuthTokens;
use App\Domain\Metrics\Catalog\Catalog;
use App\Jobs\SyncConnectionMetrics;
use App\Models\IntegrationAccount;
use App\Models\IntegrationConnection;
use App\Support\Audit\Audit;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** Cria conexões, registra as contas descobertas e dispara as sincronizações. */
final readonly class ConnectionManager
{
    /** Histórico inicial: cobre "mesmo período do ano anterior" para os últimos 30 dias. */
    public const BACKFILL_DAYS = 400;

    /** Ressincronização manual: dias recentes, que as plataformas ainda ajustam (atribuição). */
    public const RESYNC_DAYS = 30;

    public function __construct(
        private Catalog $catalog,
        private ConnectorRegistry $connectors,
        private Audit $audit,
    ) {}

    /** Destinos de dados (não são canais): a conexão guarda só o acesso, sem contas nem coleta. ADR 0027. */
    public const DESTINATIONS = ['google_sheets' => 'Google Sheets'];

    public static function isDestination(string $provider): bool
    {
        return isset(self::DESTINATIONS[$provider]);
    }

    /** Nome para as telas: canal do catálogo ou destino. */
    public function displayName(string $provider): string
    {
        return $this->catalog->provider($provider)?->name() ?? self::DESTINATIONS[$provider] ?? $provider;
    }

    public function connectDestination(string $provider, string $mode, ?OAuthTokens $tokens, ?DiscoveredAccount $account, ?string $userId): IntegrationConnection
    {
        $name = self::DESTINATIONS[$provider] ?? throw ConnectorUnavailable::unknown($provider);

        $connection = IntegrationConnection::query()->create([
            'provider' => $provider,
            'mode' => $mode === 'live' ? 'live' : 'sandbox',
            'status' => 'active',
            'label' => $mode === 'live' && $account !== null ? "{$name} · {$account->name}" : "{$name} (demonstração)",
            'credentials' => $mode === 'live' ? $tokens?->toCredentials() : null,
            'connected_by' => $userId,
        ]);
        $this->audit->record('connection.created', $connection, ['provider' => $provider, 'mode' => $connection->mode, 'destination' => true]);

        return $connection;
    }

    public function connectSandbox(string $provider, ?string $userId): IntegrationConnection
    {
        $definition = $this->catalog->provider($provider) ?? throw ConnectorUnavailable::unknown($provider);

        $connection = DB::transaction(function () use ($definition, $userId): IntegrationConnection {
            $connection = IntegrationConnection::query()->create([
                'provider' => $definition->key(),
                'mode' => 'sandbox',
                'status' => 'syncing',
                'label' => $definition->name().' (demonstração)',
                'connected_by' => $userId,
            ]);

            foreach ($this->connectors->for($connection)->discoverAccounts($connection) as $account) {
                IntegrationAccount::query()->create([
                    'connection_id' => $connection->id,
                    'provider' => $definition->key(),
                    'external_id' => $account->externalId,
                    'name' => $account->name,
                    'kind' => $account->kind,
                    'currency' => $account->currency,
                    'timezone' => $account->timezone,
                ]);
            }

            $this->audit->record('connection.created', $connection, ['provider' => $definition->key(), 'mode' => 'sandbox']);

            return $connection;
        });

        $this->dispatchSync($connection, self::BACKFILL_DAYS);

        return $connection->refresh();
    }

    /**
     * Conexão real vinda do login OAuth: tokens criptografados e contas descobertas na plataforma.
     *
     * @param  list<DiscoveredAccount>  $accounts
     */
    public function connectLive(string $provider, OAuthTokens $tokens, array $accounts, ?string $userId): IntegrationConnection
    {
        $definition = $this->catalog->provider($provider) ?? throw ConnectorUnavailable::unknown($provider);
        $canSync = $this->connectors->hasLiveConnector($provider);

        $connection = DB::transaction(function () use ($definition, $tokens, $accounts, $userId, $canSync): IntegrationConnection {
            $connection = IntegrationConnection::query()->create([
                'provider' => $definition->key(),
                'mode' => 'live',
                'status' => $canSync ? 'syncing' : 'active',
                'label' => $definition->name(),
                'credentials' => $tokens->toCredentials(),
                'connected_by' => $userId,
            ]);

            foreach ($accounts as $account) {
                IntegrationAccount::query()->create([
                    'connection_id' => $connection->id,
                    'provider' => $definition->key(),
                    'external_id' => $account->externalId,
                    'name' => $account->name,
                    'kind' => $account->kind,
                    'currency' => $account->currency,
                    'timezone' => $account->timezone,
                ]);
            }

            $this->audit->record('connection.created', $connection, ['provider' => $definition->key(), 'mode' => 'live', 'accounts' => count($accounts)]);

            return $connection;
        });

        if ($canSync) {
            $this->dispatchSync($connection, self::BACKFILL_DAYS);
        }

        return $connection->refresh();
    }

    public function resync(IntegrationConnection $connection): IntegrationConnection
    {
        $connection->forceFill(['status' => 'syncing'])->save();
        $this->dispatchSync($connection, self::RESYNC_DAYS);

        return $connection->refresh();
    }

    /** Dados vão até ontem no fuso da agência: o dia corrente ainda está incompleto. */
    public static function yesterday(): CarbonImmutable
    {
        return CarbonImmutable::now(self::timezone())->subDay()->startOfDay();
    }

    public static function timezone(): string
    {
        $timezone = config('delta.timezone');

        return is_string($timezone) ? $timezone : 'America/Sao_Paulo';
    }

    private function dispatchSync(IntegrationConnection $connection, int $days): void
    {
        $to = self::yesterday();

        SyncConnectionMetrics::dispatch($connection->id, $to->subDays($days - 1)->toDateString(), $to->toDateString());
    }
}
