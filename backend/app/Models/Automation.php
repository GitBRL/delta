<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Envio automático de um relatório (agenda, período, canais, destinatários, mensagem).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $project_id
 * @property string $report_id
 * @property string $name
 * @property list<'email'|'whatsapp'> $channels
 * @property 'daily'|'weekly'|'biweekly'|'monthly' $frequency
 * @property int|null $weekday
 * @property int|null $month_day
 * @property string $send_time
 * @property string $period_preset
 * @property string $message
 * @property bool $attach_pdf
 * @property bool $requires_approval
 * @property bool $active
 * @property CarbonInterface|null $next_run_at
 * @property CarbonInterface|null $last_run_at
 * @property string|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['project_id', 'report_id', 'name', 'channels', 'frequency', 'weekday', 'month_day', 'send_time', 'period_preset', 'message', 'attach_pdf', 'requires_approval', 'active', 'next_run_at', 'last_run_at', 'created_by'])]
class Automation extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return BelongsTo<Project, $this> */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** @return BelongsTo<Report, $this> */
    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class);
    }

    /** @return BelongsToMany<Contact, $this> */
    public function recipients(): BelongsToMany
    {
        return $this->belongsToMany(Contact::class, 'automation_recipients');
    }

    /** @return HasMany<AutomationRun, $this> */
    public function runs(): HasMany
    {
        return $this->hasMany(AutomationRun::class);
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'channels' => 'array',
            'weekday' => 'integer',
            'month_day' => 'integer',
            'attach_pdf' => 'boolean',
            'requires_approval' => 'boolean',
            'active' => 'boolean',
            'next_run_at' => 'datetime',
            'last_run_at' => 'datetime',
        ];
    }
}
