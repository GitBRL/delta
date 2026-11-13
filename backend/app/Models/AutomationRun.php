<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Uma execução de envio automático (agendada ou manual).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $automation_id
 * @property string|null $snapshot_id
 * @property string|null $share_link_id
 * @property 'schedule'|'manual' $trigger
 * @property 'awaiting_approval'|'sending'|'sent'|'partial'|'failed'|'cancelled' $status
 * @property Carbon $scheduled_for
 * @property string|null $approved_by
 * @property Carbon|null $approved_at
 * @property string|null $error
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['automation_id', 'snapshot_id', 'share_link_id', 'trigger', 'status', 'scheduled_for', 'approved_by', 'approved_at', 'error'])]
class AutomationRun extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return BelongsTo<Automation, $this> */
    public function automation(): BelongsTo
    {
        return $this->belongsTo(Automation::class);
    }

    /** @return BelongsTo<ReportSnapshot, $this> */
    public function snapshot(): BelongsTo
    {
        return $this->belongsTo(ReportSnapshot::class);
    }

    /** @return HasMany<Message, $this> */
    public function messages(): HasMany
    {
        return $this->hasMany(Message::class, 'run_id');
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['scheduled_for' => 'datetime', 'approved_at' => 'datetime'];
    }
}
