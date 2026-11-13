<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\TenantMembership;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @property User $resource */
final class MeResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $user = $this->resource;

        $tenants = [];
        foreach ($user->tenants as $tenant) {
            /** @var TenantMembership $membership */
            $membership = $tenant->getRelation('membership');

            $tenants[] = [
                'id' => $tenant->id,
                'name' => $tenant->name,
                'slug' => $tenant->slug,
                'role' => $membership->role->value,
            ];
        }

        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'two_factor_enabled' => $user->hasTwoFactorEnabled(),
            'tenants' => $tenants,
        ];
    }
}
