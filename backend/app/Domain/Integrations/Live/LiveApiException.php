<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Live;

use RuntimeException;

/** Falha numa API de plataforma. Retentável (rede, limite de chamadas) ou definitiva (permissão, métrica inválida). */
final class LiveApiException extends RuntimeException
{
    public function __construct(string $message, public readonly bool $retryable = true)
    {
        parent::__construct($message);
    }
}
