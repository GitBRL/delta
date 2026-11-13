<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Domain\Messaging\MessageStatus;
use App\Models\Message;
use App\Support\Tenancy\TenantScopedJob;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Modo demonstração do WhatsApp: simula "entregue" e "lido" como o webhook da Meta faria. */
final class SimulateWhatsAppStatus implements ShouldQueue
{
    use Queueable, TenantScopedJob;

    public function __construct(
        public readonly string $messageId,
        public readonly string $status,
    ) {
        $this->captureTenantContext();
        $this->onQueue('messages');
    }

    public function handle(): void
    {
        $message = Message::query()->find($this->messageId);
        if ($message !== null && $message->provider === 'sandbox') {
            MessageStatus::advance($message, $this->status);
        }
    }
}
