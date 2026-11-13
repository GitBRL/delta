<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * Campanha ou conjunto de uma conta de anúncios em demonstração (ADR 0030).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $account_id
 * @property string $external_id
 * @property 'campaign'|'adset' $level
 * @property string|null $parent_external_id
 * @property string $name
 * @property 'ACTIVE'|'PAUSED' $status
 * @property string|null $objective
 * @property string|null $daily_budget
 */
#[Fillable(['account_id', 'external_id', 'level', 'parent_external_id', 'name', 'status', 'objective', 'daily_budget'])]
class SandboxAdObject extends Model
{
    use BelongsToTenant, HasUuids;
}
