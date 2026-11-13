<?php

declare(strict_types=1);

namespace App\Domain\Integrations\OAuth;

/** Resultado de um fluxo de login, entregue à janela do app pela página de retorno. */
final readonly class OAuthResult
{
    /** @param 'success'|'error'|'cancelled' $status */
    public function __construct(
        public string $status,
        public string $provider,
        public ?string $flow,
        public string $returnMode = 'popup',
        public ?string $connectionId = null,
        public ?string $message = null,
    ) {}

    public static function error(string $provider, ?string $flow, string $returnMode, string $message): self
    {
        return new self('error', $provider, $flow, $returnMode, null, $message);
    }

    /** @return array<string, string> mensagem do contrato {type: 'delta:oauth', ...} */
    public function toMessage(): array
    {
        return array_filter([
            'type' => 'delta:oauth',
            'flow' => $this->flow,
            'status' => $this->status,
            'provider' => $this->provider,
            'connection_id' => $this->connectionId,
            'message' => $this->message,
        ], fn (?string $v): bool => $v !== null);
    }
}
