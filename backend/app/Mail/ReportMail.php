<?php

declare(strict_types=1);

namespace App\Mail;

use Illuminate\Mail\Attachment;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Address;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;

/** Relatório por e-mail: mensagem da agência, botão para o relatório, PDF anexo e descadastro. */
final class ReportMail extends Mailable
{
    public function __construct(
        public readonly string $subjectLine,
        public readonly string $body,
        public readonly string $url,
        public readonly string $unsubscribeUrl,
        public readonly ?string $agency,
        public readonly ?string $pdfPath = null,
        public readonly ?string $pdfName = null,
        public readonly ?string $replyToAddress = null,
    ) {}

    /** Remetente com o nome da agência (white label) e resposta direto para ela. */
    public function envelope(): Envelope
    {
        $from = config('mail.from.address');

        return new Envelope(
            from: new Address(is_string($from) ? $from : 'nao-responda@delta.local', $this->agency ?? 'Delta'),
            replyTo: $this->replyToAddress !== null ? [new Address($this->replyToAddress, $this->agency)] : [],
            subject: $this->subjectLine,
        );
    }

    public function content(): Content
    {
        return new Content(markdown: 'mail.report');
    }

    /** @return list<Attachment> */
    public function attachments(): array
    {
        return $this->pdfPath === null ? [] : [
            Attachment::fromStorageDisk('local', $this->pdfPath)->as($this->pdfName ?? 'relatorio.pdf')->withMime('application/pdf'),
        ];
    }

    /** Cabeçalho List-Unsubscribe: descadastro em um clique nos clientes de e-mail. */
    public function headers(): Headers
    {
        return new Headers(text: ['List-Unsubscribe' => '<'.$this->unsubscribeUrl.'>']);
    }
}
