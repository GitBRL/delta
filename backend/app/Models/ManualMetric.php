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
 * Métrica da fonte manual (ex.: vendas da loja física, leads do CRM). "sum" soma os dias do
 * período; "last" usa o último valor lançado (estoque, base de clientes).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $key
 * @property string $name
 * @property string|null $description
 * @property MetricUnit $unit
 * @property MetricDirection $direction
 * @property int $decimals
 * @property 'sum'|'last' $aggregation
 * @property string|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['key', 'name', 'description', 'unit', 'direction', 'decimals', 'aggregation', 'created_by'])]
class ManualMetric extends Model
{
    use BelongsToTenant, HasUuids;

    public const PREFIX = 'manual:';

    public function toSpec(): MetricSpec
    {
        return $this->aggregation === 'last'
            ? new MetricSpec($this->key, $this->name, $this->description ?? '', $this->unit, MetricKind::Snapshot, $this->direction, $this->decimals)
            : MetricSpec::additive($this->key, $this->name, $this->description ?? '', $this->unit, $this->direction, $this->decimals);
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'unit' => MetricUnit::class,
            'direction' => MetricDirection::class,
            'decimals' => 'integer',
        ];
    }
}
