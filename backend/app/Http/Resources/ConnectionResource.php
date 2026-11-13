<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Domain\Integrations\Live\AccessTokens;
use App\Models\IntegrationConnection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @property IntegrationConnection $resource */
final class ConnectionResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $connection = $this->resource;

        return [
            'id' => $connection->id,
            'provider' => $connection->provider,
            'mode' => $connection->mode,
            'status' => $connection->status,
            'label' => $connection->label,
            'last_synced_at' => $connection->last_synced_at?->toIso8601String(),
            'last_error' => $connection->last_error,
            // Token real perto do fim (Meta, ~60 dias): reconectar em um clique antes de parar.
            'expires_at' => is_string($connection->credentials['expires_at'] ?? null) && $connection->mode === 'live' ? $connection->credentials['expires_at'] : null,
            'expiring_soon' => $connection->mode === 'live' && AccessTokens::expiresSoon($connection),
            'accounts' => AccountResource::collection($connection->accounts)->resolve($request),
        ];
    }
}
