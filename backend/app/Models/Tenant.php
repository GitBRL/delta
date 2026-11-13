<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Agência (ou empresa) cliente do Delta. Unidade de isolamento de dados. */
#[Fillable(['id', 'name', 'slug', 'settings'])]
class Tenant extends Model
{
    use HasUuids;

    /** @return BelongsToMany<User, $this, TenantMembership, 'membership'> */
    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'tenant_user')
            ->using(TenantMembership::class)
            ->as('membership')
            ->withPivot(['id', 'role'])
            ->withTimestamps();
    }

    /** @return HasMany<Project, $this> */
    public function projects(): HasMany
    {
        return $this->hasMany(Project::class);
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['settings' => 'array'];
    }
}
