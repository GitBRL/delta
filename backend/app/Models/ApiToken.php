<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Token da API pública (por agência). O token só existe na criação; aqui fica o hash.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $name
 * @property string $token_prefix
 * @property string $token_hash
 * @property list<string> $scopes
 * @property Carbon|null $last_used_at
 * @property Carbon|null $expires_at
 * @property Carbon|null $revoked_at
 * @property string|null $created_by
 * @property Carbon|null $created_at
 */
#[Fillable(['name', 'token_prefix', 'token_hash', 'scopes', 'expires_at', 'revoked_at', 'created_by'])]
#[Hidden(['token_hash'])]
class ApiToken extends Model
{
    use BelongsToTenant, HasUuids;

    public const UPDATED_AT = null;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['scopes' => 'array', 'last_used_at' => 'datetime', 'expires_at' => 'datetime', 'revoked_at' => 'datetime'];
    }
}
