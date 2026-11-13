<?php

declare(strict_types=1);

namespace App\Domain\Integrations;

use RuntimeException;

/** O conector real ainda não existe (aguardando aprovação da plataforma) ou o provedor é desconhecido. */
final class ConnectorUnavailable extends RuntimeException
{
    public static function live(string $provider): self
    {
        return new self("A conexão real com {$provider} ainda não está disponível: aguardando aprovação da plataforma. Use o modo demonstração.");
    }

    /** Token expirado ou revogado: a conexão precisa ser refeita (um clique em Integrações). */
    public static function reauthorize(string $provider): self
    {
        return new self("O acesso a {$provider} expirou ou foi revogado. Reconecte a conta em Integrações (um clique).");
    }

    public static function unknown(string $provider): self
    {
        return new self("Plataforma desconhecida: {$provider}.");
    }
}
