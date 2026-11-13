<?php

declare(strict_types=1);

namespace App\Models;

use App\Domain\Metrics\Catalog\MetricDirection;
use App\Domain\Metrics\Catalog\MetricKind;
use App\Domain\Metrics\Catalog\MetricSpec;
use App\Domain\Metrics\Catalog\MetricUnit;
use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Indicador personalizado de uma agência.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $key
 * @property string $name
 * @property string|null $description
 * @property string $formula
 * @property list<string> $references
 * @property MetricUnit $unit
 * @property MetricDirection $direction
 * @property int $decimals
 * @property string|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['key', 'name', 'description', 'formula', 'references', 'unit', 'direction', 'decimals', 'created_by'])]
class CustomMetric extends Model
{
    use BelongsToTenant, HasUuids;

    public const PREFIX = 'custom:';

    public function toSpec(): MetricSpec
    {
        return new MetricSpec(
            key: $this->key,
            label: $this->name,
            description: $this->description ?? '',
            unit: $this->unit,
            kind: MetricKind::Derived,
            direction: $this->direction,
            decimals: $this->decimals,
            formula: $this->formula,
        );
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'references' => 'array',
            'unit' => MetricUnit::class,
            'direction' => MetricDirection::class,
            'decimals' => 'integer',
        ];
    }
}
