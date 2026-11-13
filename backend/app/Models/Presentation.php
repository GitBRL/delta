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
 * Apresentação do Studio (ADR 0029).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $project_id
 * @property string $title
 * @property string $brief
 * @property 'slides'|'page' $format
 * @property string $period_preset
 * @property Carbon|null $period_start
 * @property Carbon|null $period_end
 * @property string $compare
 * @property 'generating'|'ready'|'error' $status
 * @property string|null $error
 * @property int $current_version
 * @property string|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Project|null $project
 */
#[Fillable(['project_id', 'title', 'brief', 'format', 'period_preset', 'period_start', 'period_end', 'compare', 'created_by'])]
class Presentation extends Model
{
    use BelongsToTenant, HasUuids;

    protected $attributes = ['status' => 'generating', 'current_version' => 0];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['period_start' => 'date', 'period_end' => 'date', 'current_version' => 'integer'];
    }

    /** @return BelongsTo<Project, $this> */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** @return HasMany<PresentationVersion, $this> */
    public function versions(): HasMany
    {
        return $this->hasMany(PresentationVersion::class)->orderBy('number');
    }

    public function currentVersion(): ?PresentationVersion
    {
        return $this->current_version === 0 ? null : PresentationVersion::query()->where('presentation_id', $this->id)->where('number', $this->current_version)->first();
    }

    public function period(): ReportPeriod
    {
        return ReportPeriod::resolve($this->period_preset, $this->period_start?->toDateString(), $this->period_end?->toDateString());
    }

    public function comparison(): Comparison
    {
        return Comparison::tryFrom($this->compare) ?? Comparison::PreviousPeriod;
    }
}
