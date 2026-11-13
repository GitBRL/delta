<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use App\Support\Tenancy\TenantRole;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Convite pendente/aceito/revogado para a equipe de uma agência. Só o hash do token fica aqui.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $email
 * @property TenantRole $role
 * @property list<string> $project_ids
 * @property string $token_hash
 * @property string|null $invited_by
 * @property Carbon $expires_at
 * @property Carbon|null $accepted_at
 * @property string|null $accepted_by
 * @property Carbon|null $revoked_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['email', 'role', 'project_ids', 'token_hash', 'invited_by', 'expires_at', 'accepted_at', 'accepted_by', 'revoked_at'])]
#[Hidden(['token_hash'])]
class Invitation extends Model
{
    use BelongsToTenant, HasUuids;

    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'role' => TenantRole::class,
            'project_ids' => 'array',
            'expires_at' => 'datetime',
            'accepted_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }
}
