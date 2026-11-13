<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\TenantRole;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\Pivot;

/**
 * Vínculo usuário ↔ agência, com o papel do usuário naquela agência.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $user_id
 * @property TenantRole $role
 */
#[Fillable(['tenant_id', 'user_id', 'role'])]
class TenantMembership extends Pivot
{
    use HasUuids;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $table = 'tenant_user';

    /** @return BelongsTo<Tenant, $this> */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return array<string, mixed> */
    protected function casts(): array
    {
        return ['role' => TenantRole::class];
    }
}
