<?php

declare(strict_types=1);

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/** Aviso de franquia do plano (80% ou 100% no mês). Só dados prontos. ADR 0031. */
final class UsageAlertMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    /** @param list<array{label: string, used: int, limit: int, threshold: int}> $alerts */
    public function __construct(
        public readonly string $planName,
        public readonly array $alerts,
    ) {}

    public function envelope(): Envelope
    {
        $full = array_filter($this->alerts, fn (array $a): bool => $a['threshold'] >= 100) !== [];

        return new Envelope(subject: $full ? 'A franquia do plano acabou neste mês' : 'A franquia do plano está perto do fim');
    }

    public function content(): Content
    {
        return new Content(markdown: 'mail.usage-alert');
    }
}
