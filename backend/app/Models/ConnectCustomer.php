<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Customer do Delta Connect: um projeto exposto ao SaaS do merchant (ADR 0032).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $project_id
 * @property string|null $external_id
 * @property string $token_hash
 * @property string $token_prefix
 * @property array<string, mixed> $metadata
 * @property Carbon|null $revoked_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Project|null $project
 */
#[Fillable(['project_id', 'external_id', 'token_hash', 'token_prefix', 'metadata'])]
#[Hidden(['token_hash'])]
class ConnectCustomer extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['metadata' => 'array', 'revoked_at' => 'datetime'];
    }

    /** @return BelongsTo<Project, $this> */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }
}
