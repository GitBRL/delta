<?php

declare(strict_types=1);

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** Resumo das metas que mudaram de estado (para a equipe da agência). Só dados prontos. */
final class GoalAlertMail extends Mailable implements ShouldQueue
{
    use Queueable;

    /** @param list<array{project: string, headline: string, text: string, status: string}> $alerts */
    public function __construct(public readonly array $alerts) {}

    public function envelope(): Envelope
    {
        $off = count(array_filter($this->alerts, fn (array $a): bool => $a['status'] !== 'achieved'));

        return new Envelope(subject: $off > 0 ? "Metas: {$off} pedem atenção hoje" : 'Metas batidas hoje 🎉');
    }

    public function content(): Content
    {
        return new Content(markdown: 'mail.goal-alert');
    }
}
