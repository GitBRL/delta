<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Conexão de uma agência com uma plataforma (uma autorização OAuth, ou uma conexão de demonstração).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $provider
 * @property 'sandbox'|'live' $mode
 * @property 'active'|'syncing'|'error'|'expired' $status
 * @property string $label
 * @property array<string, mixed>|null $credentials
 * @property string|null $connected_by
 * @property Carbon|null $last_synced_at
 * @property string|null $last_error
 */
#[Fillable(['provider', 'mode', 'status', 'label', 'credentials', 'connected_by', 'last_synced_at', 'last_error'])]
#[Hidden(['credentials'])]
class IntegrationConnection extends Model
{
    use BelongsToTenant, HasUuids;

    protected $table = 'connections';

    /** @return HasMany<IntegrationAccount, $this> */
    public function accounts(): HasMany
    {
        return $this->hasMany(IntegrationAccount::class, 'connection_id');
    }

    public function isSandbox(): bool
    {
        return $this->mode === 'sandbox';
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'credentials' => 'encrypted:array',
            'last_synced_at' => 'datetime',
        ];
    }
}
