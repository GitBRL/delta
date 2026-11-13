<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Domain\Automations\AutomationSender;
use App\Domain\Automations\MessageComposer;
use App\Domain\Branding\Brand;
use App\Domain\Contacts\Contacts;
use App\Domain\Messaging\MessageStatus;
use App\Domain\Messaging\WhatsApp\WhatsAppGateway;
use App\Http\Controllers\Api\ReportSnapshotController;
use App\Mail\ReportMail;
use App\Models\Automation;
use App\Models\AutomationRun;
use App\Models\Message;
use App\Models\ReportSnapshot;
use App\Support\Tenancy\TenantScopedJob;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Envia uma mensagem de relatório (e-mail ou WhatsApp). O link público vem no payload (o banco
 * só tem o hash); o corpo guardado para a agência leva o link mascarado.
 */
final class SendMessage implements ShouldQueue
{
    use Queueable, TenantScopedJob;

    public int $tries = 5;

    /** @var list<int> */
    public array $backoff = [20, 60, 180, 600];

    /** Quantas vezes espera o PDF ficar pronto antes de enviar só com o link. */
    private const PDF_WAITS = 6;

    public function __construct(
        public readonly string $messageId,
        public readonly string $url,
    ) {
        $this->captureTenantContext();
        $this->onQueue('messages');
    }

    public function handle(WhatsAppGateway $whatsapp): void
    {
        $message = Message::query()->with('contact')->find($this->messageId);
        if ($message === null || $message->status !== 'queued') {
            return;
        }

        $run = AutomationRun::query()->findOrFail($message->run_id);
        $automation = Automation::query()->findOrFail($run->automation_id);
        $snapshot = ReportSnapshot::query()->findOrFail($run->snapshot_id);
        $contact = $message->contact;

        if ($contact === null || ! $contact->canReceive($message->channel)) {
            $message->forceFill(['status' => 'skipped', 'error' => 'O contato retirou o consentimento antes do envio.'])->save();
            AutomationSender::settle($run);

            return;
        }

        $data = $snapshot->data;
        $text = MessageComposer::render($automation->message, $contact, $data, $this->url);

        if ($message->channel === 'email') {
            if ($automation->attach_pdf && $snapshot->pdf_status === 'pending' && $this->attempts() <= self::PDF_WAITS) {
                $this->release(20); // o PDF está saindo do forno

                return;
            }

            $pdf = $automation->attach_pdf && $snapshot->pdf_status === 'ready' ? $snapshot->pdf_path : null;
            $brand = Brand::current($snapshot->tenant_id);
            Mail::to((string) $contact->email)->send(new ReportMail(
                subjectLine: MessageComposer::subject($data),
                body: $text,
                url: $this->url,
                unsubscribeUrl: Contacts::unsubscribeUrl($contact, 'email'),
                agency: $brand->name,
                pdfPath: $pdf,
                pdfName: $pdf !== null ? ReportSnapshotController::filename($snapshot) : null,
                replyToAddress: $brand->replyTo,
            ));
            $message->forceFill(['provider' => 'smtp', 'body' => self::mask($text)])->save();
            MessageStatus::advance($message, 'sent');

            return;
        }

        $sent = $whatsapp->send((string) $contact->phone, MessageComposer::templateParams($contact, $data, $this->url));
        $message->forceFill(['provider' => $sent['provider'], 'provider_message_id' => $sent['id'], 'body' => self::mask($text)])->save();
        MessageStatus::advance($message, 'sent');

        if ($sent['provider'] === 'sandbox') {
            SimulateWhatsAppStatus::dispatch($message->id, 'delivered')->delay(now()->addSeconds(3));
            SimulateWhatsAppStatus::dispatch($message->id, 'read')->delay(now()->addSeconds(12));
        }
    }

    public function failed(?Throwable $e): void
    {
        $message = Message::query()->find($this->messageId);
        if ($message !== null) {
            MessageStatus::advance($message, 'failed', error: $e?->getMessage() ?? 'Falha no envio.');
        }
    }

    private function mask(string $text): string
    {
        $token = substr($this->url, strrpos($this->url, '/') + 1);

        return str_replace($token, substr($token, 0, 6).'…', $text);
    }
}
