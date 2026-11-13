<?php

declare(strict_types=1);

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/** E-mail de convite para a equipe. Só dados prontos (sem models): a fila não precisa de contexto de agência. */
final class InvitationMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    /** @param list<string> $projectNames */
    public function __construct(
        public readonly string $tenantName,
        public readonly ?string $inviterName,
        public readonly string $roleLabel,
        public readonly array $projectNames,
        public readonly string $url,
        public readonly string $expiresAt,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: ($this->inviterName ?? 'Sua agência').' convidou você para a '.$this->tenantName.' no Delta');
    }

    public function content(): Content
    {
        return new Content(markdown: 'mail.invitation');
    }
}
