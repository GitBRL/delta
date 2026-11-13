<?php

declare(strict_types=1);

namespace App\Domain\Messaging;

use App\Domain\Automations\AutomationSender;
use App\Models\AutomationRun;
use App\Models\Message;
use Carbon\CarbonImmutable;

/** Status de entrega só avança (queued → sent → delivered → read); webhooks chegam fora de ordem. */
final class MessageStatus
{
    public static function advance(Message $message, string $status, ?CarbonImmutable $at = null, ?string $error = null): void
    {
        $at ??= CarbonImmutable::now();

        if ($status === 'failed') {
            if (! in_array($message->status, ['delivered', 'read'], true)) {
                $message->forceFill(['status' => 'failed', 'error' => $error !== null ? mb_substr($error, 0, 300) : 'Falha na entrega.'])->save();
            }
        } elseif (isset(Message::PROGRESS[$status], Message::PROGRESS[$message->status]) && Message::PROGRESS[$status] > Message::PROGRESS[$message->status]) {
            $fill = ['status' => $status];
            foreach (['sent' => 'sent_at', 'delivered' => 'delivered_at', 'read' => 'read_at'] as $step => $column) {
                if (Message::PROGRESS[$step] <= Message::PROGRESS[$status] && $message->{$column} === null) {
                    $fill[$column] = $at;
                }
            }
            $message->forceFill($fill)->save();
        } else {
            return;
        }

        $run = AutomationRun::query()->find($message->run_id);
        if ($run !== null) {
            AutomationSender::settle($run);
        }
    }
}
