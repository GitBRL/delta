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
 * Exportação agendada para Google Sheets (ADR 0027).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $project_id
 * @property string $connection_id
 * @property string $name
 * @property list<string> $metrics
 * @property int $days
 * @property 'daily'|'weekly' $frequency
 * @property bool $active
 * @property string|null $spreadsheet_id
 * @property string|null $spreadsheet_url
 * @property Carbon|null $last_run_at
 * @property 'running'|'ok'|'error'|null $last_status
 * @property string|null $last_error
 * @property array{rows: list<list<string|float|null>>, total_rows: int}|null $last_preview
 * @property string|null $created_by
 * @property-read Project|null $project
 * @property-read IntegrationConnection|null $destination
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['project_id', 'connection_id', 'name', 'metrics', 'days', 'frequency', 'active', 'created_by'])]
class SheetSync extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['metrics' => 'array', 'active' => 'boolean', 'days' => 'integer', 'last_run_at' => 'datetime', 'last_preview' => 'array'];
    }

    /** @return BelongsTo<Project, $this> */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** @return BelongsTo<IntegrationConnection, $this> */
    public function destination(): BelongsTo
    {
        return $this->belongsTo(IntegrationConnection::class, 'connection_id');
    }
}
