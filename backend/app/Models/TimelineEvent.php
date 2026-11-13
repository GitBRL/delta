<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Marco na linha do tempo do projeto (manual ou automático).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $project_id
 * @property string $type
 * @property string $title
 * @property string|null $description
 * @property Carbon $occurred_on
 * @property array<string, mixed> $metadata
 * @property string|null $created_by
 * @property Carbon|null $created_at
 */
#[Fillable(['project_id', 'type', 'title', 'description', 'occurred_on', 'metadata', 'created_by'])]
class TimelineEvent extends Model
{
    use BelongsToTenant, HasUuids;

    public const TYPES = ['manual', 'report_published', 'automation_sent', 'goal_achieved', 'goal_off_track', 'goal_at_risk', 'action_applied', 'action_result'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['occurred_on' => 'date', 'metadata' => 'array'];
    }
}
