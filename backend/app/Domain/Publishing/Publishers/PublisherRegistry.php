<?php

declare(strict_types=1);

namespace App\Domain\Publishing\Publishers;

use App\Domain\Integrations\Live\LiveApiException;
use App\Models\PostTarget;

/**
 * Publicador de um destino: demonstração para contas em demonstração; senão, o da rede.
 * Sem conta (removida depois do agendamento), falha: nunca "publica" de mentira.
 */
final readonly class PublisherRegistry
{
    public function for(PostTarget $target): Publisher
    {
        $connection = $target->account?->integration()->first();
        if ($connection === null) {
            throw new LiveApiException('A conta deste destino foi removida das integrações. Escolha outra conta e tente de novo.', retryable: false);
        }
        if ($connection->isSandbox()) {
            return new SandboxPublisher;
        }

        return match ($target->network) {
            'instagram' => app(InstagramPublisher::class),
            'facebook' => app(FacebookPublisher::class),
            default => new UnavailablePublisher,
        };
    }
}
