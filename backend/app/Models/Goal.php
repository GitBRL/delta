<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Meta de um projeto para uma métrica, por mês ou semana.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $project_id
 * @property string $metric_key
 * @property 'at_least'|'at_most' $comparison
 * @property string $target
 * @property 'month'|'week' $period
 * @property bool $active
 * @property string|null $last_status
 * @property string|null $last_period
 * @property string|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['project_id', 'metric_key', 'comparison', 'target', 'period', 'active', 'last_status', 'last_period', 'created_by'])]
class Goal extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return BelongsTo<Project, $this> */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['active' => 'boolean'];
    }
}
