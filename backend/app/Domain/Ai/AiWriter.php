<?php

declare(strict_types=1);

namespace App\Domain\Ai;

/** Gera texto com um modelo de linguagem. Interface para os testes não chamarem a API real. */
interface AiWriter
{
    /** @param list<array{role: 'user'|'assistant', content: string}> $messages */
    public function generate(string $apiKey, string $system, array $messages): AiReply;
}
