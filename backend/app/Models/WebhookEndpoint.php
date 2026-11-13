<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string $url
 * @property string|null $description
 * @property string $secret
 * @property list<string> $events
 * @property bool $active
 * @property int $failure_count
 * @property Carbon|null $disabled_at
 * @property string|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['url', 'description', 'secret', 'events', 'active', 'failure_count', 'disabled_at', 'created_by'])]
#[Hidden(['secret'])]
class WebhookEndpoint extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['secret' => 'encrypted', 'events' => 'array', 'active' => 'boolean', 'failure_count' => 'integer', 'disabled_at' => 'datetime'];
    }
}
