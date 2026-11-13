<?php

declare(strict_types=1);

namespace App\Domain\Automations;

use App\Domain\Billing\Entitlements;
use App\Domain\Reports\SharedReports;
use App\Domain\Timeline\Timeline;
use App\Domain\Webhooks\Webhooks;
use App\Jobs\SendMessage;
use App\Models\AutomationRun;
use App\Models\Message;
use App\Models\ReportSnapshot;

/**
 * Distribui uma execução: um link público (90 dias) e uma mensagem por contato e canal.
 * Só recebe quem tem consentimento no canal (o resto fica registrado como "skipped", com o motivo).
 */
final readonly class AutomationSender
{
    public const LINK_DAYS = 90;

    public function __construct(private SharedReports $shared) {}

    public function send(AutomationRun $run): void
    {
        $automation = $run->automation()->with('recipients')->firstOrFail();
        $snapshot = $run->snapshot_id !== null ? ReportSnapshot::query()->find($run->snapshot_id) : null;

        if ($snapshot === null) {
            $run->forceFill(['status' => 'failed', 'error' => 'A versão publicada deste envio não existe mais.'])->save();

            return;
        }

        [$link, $token] = $this->shared->create($snapshot, self::LINK_DAYS, null);
        $run->forceFill(['share_link_id' => $link->id])->save();
        $url = SharedReports::url($token);

        $queued = 0;
        $whatsappLeft = in_array('whatsapp', $automation->channels, true) ? app(Entitlements::class)->remaining('whatsapp_messages') : null;
        foreach ($automation->recipients as $contact) {
            foreach ($automation->channels as $channel) {
                $ok = $contact->canReceive($channel);
                $overFranchise = $ok && $channel === 'whatsapp' && $whatsappLeft !== null && $whatsappLeft <= 0;
                $ok = $ok && ! $overFranchise;
                $message = Message::query()->firstOrCreate(
                    ['run_id' => $run->id, 'contact_id' => $contact->id, 'channel' => $channel],
                    [
                        'recipient' => (string) ($channel === 'email' ? $contact->email : $contact->phone),
                        'status' => $ok ? 'queued' : 'skipped',
                        'error' => $ok ? null : ($overFranchise ? 'Franquia de WhatsApp do mês esgotada no plano da agência.' : self::skipReason($channel, $contact->email, $contact->phone)),
                    ],
                );

                if ($ok && $message->wasRecentlyCreated) {
                    SendMessage::dispatch($message->id, $url);
                    $queued++;
                    if ($channel === 'whatsapp' && $whatsappLeft !== null) {
                        $whatsappLeft--;
                    }
                }
            }
        }

        if ($queued === 0) {
            $run->forceFill(['status' => 'failed', 'error' => 'Nenhum destinatário com consentimento nos canais escolhidos.'])->save();
        }
    }

    /** Fecha o status da execução quando todas as mensagens terminaram. */
    public static function settle(AutomationRun $run): void
    {
        $raw = Message::query()->where('run_id', $run->id)->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
        $count = fn (string $status): int => is_numeric($n = $raw->get($status)) ? (int) $n : 0;
        if ($count('queued') > 0 || $run->status !== 'sending') {
            return;
        }

        $ok = $count('sent') + $count('delivered') + $count('read');
        $failed = $count('failed');

        $status = match (true) {
            $ok > 0 && $failed === 0 => 'sent',
            $ok > 0 => 'partial',
            default => 'failed',
        };
        $run->forceFill(['status' => $status])->save();
        Webhooks::emit($status === 'failed' ? 'automation.failed' : 'automation.sent', [
            'run_id' => $run->id, 'automation_id' => $run->automation_id, 'snapshot_id' => $run->snapshot_id, 'status' => $status, 'delivered' => $ok, 'failed' => $failed,
        ]);

        if ($status !== 'failed' && ($automation = $run->automation()->first()) !== null) {
            app(Timeline::class)->record($automation->project_id, 'automation_sent', "Relatório enviado: {$automation->name}",
                "{$ok} mensagem(ns) entregue(s)".($failed > 0 ? ", {$failed} com falha" : '').'.', metadata: ['run_id' => $run->id]);
        }
    }

    private static function skipReason(string $channel, ?string $email, ?string $phone): string
    {
        $missing = $channel === 'email' ? $email === null || $email === '' : $phone === null || $phone === '';

        return match (true) {
            $missing => $channel === 'email' ? 'Contato sem e-mail.' : 'Contato sem WhatsApp.',
            default => $channel === 'email' ? 'Contato sem consentimento para e-mail.' : 'Contato sem consentimento para WhatsApp.',
        };
    }
}
