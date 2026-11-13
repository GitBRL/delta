<?php

declare(strict_types=1);

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Address;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Pedido de aprovação de post ao cliente (ADR 0028), com o nome e o e-mail de resposta da
 * agência (marca própria). Só dados prontos: a fila não precisa de contexto de agência.
 */
final class PostApprovalMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $projectName,
        public readonly string $contactName,
        public readonly ?string $postTitle,
        public readonly string $url,
        public readonly ?string $agency = null,
        public readonly ?string $replyToAddress = null,
    ) {}

    public function envelope(): Envelope
    {
        $from = config('mail.from.address');

        return new Envelope(
            from: new Address(is_string($from) ? $from : 'nao-responda@delta.local', $this->agency ?? 'Delta'),
            replyTo: $this->replyToAddress !== null ? [new Address($this->replyToAddress, $this->agency)] : [],
            subject: "Post para aprovar · {$this->projectName}",
        );
    }

    public function content(): Content
    {
        return new Content(markdown: 'mail.post-approval');
    }
}
