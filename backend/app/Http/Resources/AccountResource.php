<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\IntegrationAccount;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @property IntegrationAccount $resource */
final class AccountResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $account = $this->resource;

        return [
            'id' => $account->id,
            'provider' => $account->provider,
            'name' => $account->name,
            'kind' => $account->kind,
            'currency' => $account->currency,
            'external_id' => $account->external_id,
        ];
    }
}
