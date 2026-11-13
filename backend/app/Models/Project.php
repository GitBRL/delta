<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Projeto = cliente final da agência. Isolado por tenant (RLS + TenantScope).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $name
 * @property string|null $niche
 * @property array<string, mixed>|null $settings
 */
#[Fillable(['name', 'niche', 'settings'])]
class Project extends Model
{
    use BelongsToTenant, HasUuids;

    /** Default também no model: com o modo estrito, ler "settings" de um projeto recém-criado falharia. */
    protected $attributes = ['settings' => '{}'];

    /** @return HasMany<ProjectMember, $this> */
    public function members(): HasMany
    {
        return $this->hasMany(ProjectMember::class);
    }

    /** @return BelongsToMany<IntegrationAccount, $this, ProjectAccount, 'link'> */
    public function accounts(): BelongsToMany
    {
        return $this->belongsToMany(IntegrationAccount::class, 'project_accounts', 'project_id', 'integration_account_id')
            ->using(ProjectAccount::class)
            ->as('link')
            ->withTimestamps();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['settings' => 'array'];
    }
}
