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
 * @property string $id
 * @property string $tenant_id
 * @property string|null $contact_id
 * @property string $phone
 * @property 'in'|'out' $direction
 * @property string $body
 * @property string|null $provider_message_id
 * @property string $status
 * @property string|null $sent_by
 * @property Carbon|null $read_at
 * @property Carbon|null $created_at
 */
#[Fillable(['contact_id', 'phone', 'direction', 'body', 'provider_message_id', 'status', 'sent_by', 'read_at', 'created_at'])]
class WhatsAppMessage extends Model
{
    use BelongsToTenant, HasUuids;

    public const UPDATED_AT = null;

    protected $table = 'whatsapp_messages';

    /** @return BelongsTo<Contact, $this> */
    public function contact(): BelongsTo
    {
        return $this->belongsTo(Contact::class);
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['read_at' => 'datetime', 'created_at' => 'datetime'];
    }
}
