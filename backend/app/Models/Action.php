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
 * Item do plano de ação (normalmente nascido de um sinal do semáforo), com medição de impacto.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $project_id
 * @property string|null $rule
 * @property string $metric_key
 * @property string $title
 * @property string|null $suggestion
 * @property 'open'|'doing'|'done'|'dismissed' $status
 * @property string|null $assignee_id
 * @property Carbon|null $due_on
 * @property string|null $dismissed_reason
 * @property Carbon|null $applied_at
 * @property array{value: float|null, start: string, end: string}|null $baseline
 * @property array{value: float|null, start: string, end: string, change_pct: float|null, improved: bool|null}|null $outcome
 * @property Carbon|null $measured_at
 * @property 'useful'|'not_useful'|null $feedback
 * @property string|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['project_id', 'rule', 'metric_key', 'title', 'suggestion', 'status', 'assignee_id', 'due_on', 'dismissed_reason', 'applied_at', 'baseline', 'outcome', 'measured_at', 'feedback', 'created_by'])]
class Action extends Model
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
        return [
            'due_on' => 'date',
            'applied_at' => 'datetime',
            'measured_at' => 'datetime',
            'baseline' => 'array',
            'outcome' => 'array',
        ];
    }
}
