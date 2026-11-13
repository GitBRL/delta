<?php

declare(strict_types=1);

namespace App\Domain\Ai;

/** Resposta do modelo: texto, tokens gastos e se ele recusou. */
final readonly class AiReply
{
    public function __construct(
        public string $text,
        public int $inputTokens,
        public int $outputTokens,
        public bool $refused = false,
    ) {}
}
