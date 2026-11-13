<?php

declare(strict_types=1);

namespace App\Models;

use App\Domain\Metrics\Query\Comparison;
use App\Domain\Reports\ReportPeriod;
use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Relatório editável de um projeto (o montador). As versões publicadas são os snapshots.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $project_id
 * @property string $title
 * @property string|null $template
 * @property string $period_preset
 * @property Carbon|null $period_start
 * @property Carbon|null $period_end
 * @property Comparison $compare
 * @property array{sections: list<array{id: string, title: string, blocks: list<array<string, mixed>>}>} $layout
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['project_id', 'title', 'template', 'period_preset', 'period_start', 'period_end', 'compare', 'layout', 'created_by', 'updated_by'])]
class Report extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return BelongsTo<Project, $this> */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** @return HasMany<ReportSnapshot, $this> */
    public function snapshots(): HasMany
    {
        return $this->hasMany(ReportSnapshot::class);
    }

    /** Período atual do relatório (presets relativos são recalculados a cada chamada). */
    public function period(): ReportPeriod
    {
        return ReportPeriod::resolve($this->period_preset, $this->period_start?->toDateString(), $this->period_end?->toDateString());
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'layout' => 'array',
            'compare' => Comparison::class,
            'period_start' => 'date',
            'period_end' => 'date',
        ];
    }
}
