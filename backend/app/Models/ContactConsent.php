<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * Registro de consentimento (append-only): quem, quando, por qual canal e de onde veio.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $contact_id
 * @property 'email'|'whatsapp' $channel
 * @property bool $granted
 * @property 'manual'|'unsubscribe_link'|'whatsapp_reply' $source
 * @property string|null $recorded_by
 * @property string|null $ip
 * @property Carbon|null $created_at
 */
#[Fillable(['contact_id', 'channel', 'granted', 'source', 'recorded_by', 'ip'])]
class ContactConsent extends Model
{
    use BelongsToTenant, HasUuids;

    public const UPDATED_AT = null;

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('contact_consents é append-only.'));
        static::deleting(fn () => throw new LogicException('contact_consents é append-only.'));
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['granted' => 'boolean', 'created_at' => 'datetime'];
    }
}
