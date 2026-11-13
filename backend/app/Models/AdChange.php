<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Mudança feita numa campanha ou conjunto de anúncios pelo Delta (ADR 0030).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string|null $account_id
 * @property string|null $project_id
 * @property 'campaign'|'adset' $level
 * @property string $object_id
 * @property string $object_name
 * @property 'pause'|'activate'|'budget' $action
 * @property array<string, mixed> $before
 * @property array<string, mixed> $after
 * @property 'applied'|'failed' $status
 * @property string|null $error
 * @property string|null $idempotency_key
 * @property string|null $created_by
 * @property Carbon|null $created_at
 */
#[Fillable(['account_id', 'project_id', 'level', 'object_id', 'object_name', 'action', 'before', 'after', 'status', 'error', 'idempotency_key', 'created_by'])]
class AdChange extends Model
{
    use BelongsToTenant, HasUuids;

    public const UPDATED_AT = null;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['before' => 'array', 'after' => 'array'];
    }
}
