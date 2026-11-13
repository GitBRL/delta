<?php

declare(strict_types=1);

namespace App\Domain\Integrations\OAuth\Apps;

/**
 * Resultado de conferir as credenciais de um app com a própria plataforma.
 *  verified    a plataforma reconheceu o ID e a chave secreta
 *  invalid     a plataforma recusou (mensagem diz o que conferir)
 *  unreachable não deu para perguntar agora (rede, instabilidade); nada é concluído
 */
final readonly class AppVerification
{
    /** @param 'verified'|'invalid'|'unreachable' $status */
    private function __construct(
        public string $status,
        public string $message,
    ) {}

    public static function verified(string $message): self
    {
        return new self('verified', $message);
    }

    public static function invalid(string $message): self
    {
        return new self('invalid', $message);
    }

    /** A plataforma não oferece como conferir só o app: fica "não verificado" com a explicação. */
    public static function unverifiable(string $message): self
    {
        return new self('unreachable', $message);
    }

    public static function unreachable(string $vendor): self
    {
        return new self('unreachable', "Não foi possível falar com {$vendor} agora. As credenciais estão salvas; teste de novo em instantes.");
    }

    /** @return array{status: string, message: string} */
    public function toArray(): array
    {
        return ['status' => $this->status, 'message' => $this->message];
    }
}
