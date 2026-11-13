<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Valor lançado de uma métrica manual, por projeto e dia.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $manual_metric_id
 * @property string $project_id
 * @property Carbon $date
 * @property string $value
 * @property string|null $updated_by
 */
#[Fillable(['manual_metric_id', 'project_id', 'date', 'value', 'updated_by'])]
class ManualMetricValue extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['date' => 'date'];
    }
}
