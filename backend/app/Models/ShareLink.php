<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Link público de um snapshot. O token só existe no link; aqui fica o hash.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string|null $snapshot_id
 * @property string|null $report_id
 * @property string $token_hash
 * @property string|null $password_hash
 * @property Carbon|null $expires_at
 * @property Carbon|null $revoked_at
 * @property int $view_count
 * @property Carbon|null $last_viewed_at
 * @property string|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['snapshot_id', 'report_id', 'token_hash', 'password_hash', 'expires_at', 'revoked_at', 'created_by'])]
#[Hidden(['token_hash', 'password_hash'])]
class ShareLink extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return BelongsTo<ReportSnapshot, $this> */
    public function snapshot(): BelongsTo
    {
        return $this->belongsTo(ReportSnapshot::class, 'snapshot_id');
    }

    public function isActive(): bool
    {
        return $this->revoked_at === null && ($this->expires_at === null || $this->expires_at->isFuture());
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'revoked_at' => 'datetime',
            'last_viewed_at' => 'datetime',
            'view_count' => 'integer',
        ];
    }
}
