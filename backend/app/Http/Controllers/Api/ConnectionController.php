<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\ConnectorRegistry;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreConnectionRequest;
use App\Http\Requests\SyncConnectionRequest;
use App\Http\Resources\ConnectionResource;
use App\Models\IntegrationConnection;
use App\Support\Tenancy\AuthIdentifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\ValidationException;

final class ConnectionController extends Controller
{
    public function __construct(private readonly ConnectionManager $manager) {}

    public function index(): AnonymousResourceCollection
    {
        return ConnectionResource::collection(
            // Só canais de dados; destinos do Sync (Google Sheets) ficam em /api/sync/destinations.
            IntegrationConnection::query()->with('accounts')->whereNotIn('provider', array_keys(ConnectionManager::DESTINATIONS))->orderBy('created_at')->get(),
        );
    }

    public function store(StoreConnectionRequest $request): JsonResponse
    {
        $user = $request->user() ?? abort(401);

        $connection = $this->manager->connectSandbox($request->string('provider')->toString(), AuthIdentifier::of($user));

        return (new ConnectionResource($connection->load('accounts')))->response()->setStatusCode(201);
    }

    public function sync(SyncConnectionRequest $request, IntegrationConnection $connection, ConnectorRegistry $connectors): JsonResponse
    {
        if (ConnectionManager::isDestination($connection->provider)) {
            throw ValidationException::withMessages(['connection' => 'Destinos do Sync não têm coleta: as exportações rodam em Sync.']);
        }
        if (! $connection->isSandbox() && ! $connectors->hasLiveConnector($connection->provider)) {
            throw ValidationException::withMessages(['connection' => 'A coleta de dados reais desta plataforma ainda está em desenvolvimento.']);
        }

        $connection = $this->manager->resync($connection);

        return (new ConnectionResource($connection->load('accounts')))->response()->setStatusCode(202);
    }
}
