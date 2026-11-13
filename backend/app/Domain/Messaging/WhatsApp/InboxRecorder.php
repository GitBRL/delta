<?php

declare(strict_types=1);

namespace App\Domain\Messaging\WhatsApp;

use App\Models\Contact;
use App\Models\WhatsAppMessage;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/** Grava mensagens recebidas na caixa de respostas, ligadas ao contato pelo telefone (idempotente pelo id da Meta). */
final class InboxRecorder
{
    public static function received(string $phone, string $text, ?string $providerId): ?WhatsAppMessage
    {
        try {
            // Savepoint: a duplicata (reenvio da Meta) é descartada sem abortar a transação de fora.
            return DB::transaction(fn (): WhatsAppMessage => WhatsAppMessage::query()->create([
                'contact_id' => Contact::query()->where('phone', $phone)->value('id'),
                'phone' => $phone,
                'direction' => 'in',
                'body' => mb_substr($text, 0, 4096),
                'provider_message_id' => $providerId,
                'status' => 'received',
                'created_at' => now(),
            ]));
        } catch (UniqueConstraintViolationException) {
            return null; // a Meta reenviou o mesmo evento
        }
    }
}
