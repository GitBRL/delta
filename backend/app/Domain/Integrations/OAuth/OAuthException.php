<?php

declare(strict_types=1);

namespace App\Domain\Integrations\OAuth;

use RuntimeException;

/** Falha no login de uma plataforma. A mensagem é mostrada ao usuário (pt-BR, sem detalhes internos). */
final class OAuthException extends RuntimeException
{
    public static function platform(string $what): self
    {
        return new self("A plataforma recusou {$what}. Tente conectar de novo; se persistir, verifique as permissões da conta.");
    }
}
