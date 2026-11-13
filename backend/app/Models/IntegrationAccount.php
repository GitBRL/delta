<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * Conta dentro de uma conexão: conta de anúncios, página, propriedade do GA4, perfil.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $connection_id
 * @property string $provider
 * @property string $external_id
 * @property string $name
 * @property string $kind
 * @property string|null $currency
 * @property string|null $timezone
 */
#[Fillable(['connection_id', 'provider', 'external_id', 'name', 'kind', 'currency', 'timezone'])]
class IntegrationAccount extends Model
{
    use BelongsToTenant, HasUuids;

    /**
     * Conexão de origem. Não se chama "connection" porque colidiria com Model::$connection
     * (o nome da conexão de banco do Eloquent).
     *
     * @return BelongsTo<IntegrationConnection, $this>
     */
    public function integration(): BelongsTo
    {
        return $this->belongsTo(IntegrationConnection::class, 'connection_id');
    }

    /** @return BelongsToMany<Project, $this, ProjectAccount, 'link'> */
    public function projects(): BelongsToMany
    {
        return $this->belongsToMany(Project::class, 'project_accounts', 'integration_account_id', 'project_id')
            ->using(ProjectAccount::class)
            ->as('link')
            ->withTimestamps();
    }
}
