<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string $endpoint_id
 * @property string $event
 * @property array<string, mixed> $payload
 * @property 'pending'|'delivered'|'failed' $status
 * @property int $attempts
 * @property int|null $last_status_code
 * @property string|null $last_error
 * @property Carbon|null $delivered_at
 * @property Carbon|null $created_at
 */
#[Fillable(['endpoint_id', 'event', 'payload', 'status', 'attempts', 'last_status_code', 'last_error', 'delivered_at'])]
class WebhookDelivery extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['payload' => 'array', 'attempts' => 'integer', 'last_status_code' => 'integer', 'delivered_at' => 'datetime'];
    }
}
