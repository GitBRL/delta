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
 * Mensagem de um envio (uma por contato e canal), com o status de entrega.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $run_id
 * @property string|null $contact_id
 * @property 'email'|'whatsapp' $channel
 * @property string $recipient
 * @property string|null $provider
 * @property string|null $provider_message_id
 * @property 'queued'|'sent'|'delivered'|'read'|'failed'|'skipped' $status
 * @property string|null $body
 * @property string|null $error
 * @property Carbon|null $sent_at
 * @property Carbon|null $delivered_at
 * @property Carbon|null $read_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['run_id', 'contact_id', 'channel', 'recipient', 'provider', 'provider_message_id', 'status', 'body', 'error', 'sent_at', 'delivered_at', 'read_at'])]
class Message extends Model
{
    use BelongsToTenant, HasUuids;

    /** Ordem do ciclo de vida: status só avança (webhooks podem chegar fora de ordem). */
    public const PROGRESS = ['queued' => 0, 'sent' => 1, 'delivered' => 2, 'read' => 3];

    /** @return BelongsTo<AutomationRun, $this> */
    public function run(): BelongsTo
    {
        return $this->belongsTo(AutomationRun::class, 'run_id');
    }

    /** @return BelongsTo<Contact, $this> */
    public function contact(): BelongsTo
    {
        return $this->belongsTo(Contact::class);
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['sent_at' => 'datetime', 'delivered_at' => 'datetime', 'read_at' => 'datetime'];
    }
}
