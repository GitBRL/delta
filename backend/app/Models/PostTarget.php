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
 * Destino de um post: rede, formato e conta (ADR 0028).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $post_id
 * @property 'instagram'|'facebook'|'youtube' $network
 * @property string $format
 * @property string|null $account_id
 * @property 'pending'|'publishing'|'published'|'failed' $status
 * @property string|null $external_id
 * @property string|null $permalink
 * @property string|null $error
 * @property int $attempts
 * @property Carbon|null $published_at
 * @property array<string, mixed> $options
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read IntegrationAccount|null $account
 */
#[Fillable(['post_id', 'network', 'format', 'account_id', 'options'])]
class PostTarget extends Model
{
    use BelongsToTenant, HasUuids;

    protected $attributes = ['status' => 'pending', 'options' => '{}', 'attempts' => 0];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['options' => 'array', 'attempts' => 'integer', 'published_at' => 'datetime'];
    }

    /** @return BelongsTo<IntegrationAccount, $this> */
    public function account(): BelongsTo
    {
        return $this->belongsTo(IntegrationAccount::class, 'account_id');
    }
}
