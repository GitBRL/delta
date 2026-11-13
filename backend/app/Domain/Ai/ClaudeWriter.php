<?php

declare(strict_types=1);

namespace App\Domain\Ai;

use Anthropic\Client;
use Anthropic\Core\Exceptions\APIConnectionException;
use Anthropic\Core\Exceptions\APIStatusException;
use Anthropic\Core\Exceptions\AuthenticationException;
use Anthropic\Core\Exceptions\PermissionDeniedException;
use Anthropic\Core\Exceptions\RateLimitException;

/**
 * Claude pela API oficial (SDK PHP). Claude Opus 5.5 com esforço "medium" (análises curtas) e
 * fallback de recusa no servidor (outro modelo responde se este declinar por política).
 */
final class ClaudeWriter implements AiWriter
{
    public const MODEL = 'claude-opus-5-5';

    public function generate(string $apiKey, string $system, array $messages): AiReply
    {
        try {
            $message = (new Client(apiKey: $apiKey))->beta->messages->create(
                maxTokens: 8000,
                messages: $messages,
                model: self::MODEL,
                system: $system,
                outputConfig: ['effort' => 'medium'],
                fallbacks: 'default',
                betas: ['server-side-fallback-2026-07-01'],
            );
        } catch (AuthenticationException|PermissionDeniedException) {
            throw new AiException('A chave da API de IA foi recusada. Um administrador pode trocá-la em Configurações › IA.');
        } catch (RateLimitException) {
            throw new AiException('O limite de uso da API de IA foi atingido agora. Tente de novo em alguns minutos.');
        } catch (APIConnectionException) {
            throw new AiException('Não foi possível falar com o serviço de IA agora. Tente de novo em instantes.');
        } catch (APIStatusException $e) {
            report($e);

            throw new AiException('O serviço de IA não conseguiu responder agora. Tente de novo em instantes.');
        }

        $text = '';
        foreach ($message->content as $block) {
            if ($block->type === 'text' && property_exists($block, 'text') && is_string($block->text)) {
                $text .= $block->text;
            }
        }

        return new AiReply(trim($text), $message->usage->inputTokens, $message->usage->outputTokens, $message->stopReason === 'refusal');
    }
}
