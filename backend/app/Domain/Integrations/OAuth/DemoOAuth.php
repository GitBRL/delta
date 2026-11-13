<?php

declare(strict_types=1);

namespace App\Domain\Integrations\OAuth;

/**
 * Login de demonstração: mesma jornada do pop-up real (janela, tela de autorização, retorno),
 * mas a "plataforma" é uma página do próprio Delta, claramente marcada como demonstração.
 * As contas e os dados vêm do SandboxConnector.
 */
final class DemoOAuth implements OAuthProvider
{
    public function isConfigured(string $platform): bool
    {
        return true;
    }

    public function usesPkce(): bool
    {
        return false;
    }

    public function authorizationUrl(string $platform, string $state, string $redirectUri, ?string $codeChallenge): string
    {
        // Relativa: o pop-up está na origem do app, que encaminha /oauth/* para a API.
        return "/oauth/{$platform}/demo?".http_build_query(['state' => $state]);
    }

    public function exchange(string $platform, string $code, string $redirectUri, ?string $codeVerifier): OAuthTokens
    {
        if (! str_starts_with($code, 'demo_')) {
            throw OAuthException::platform('a autorização');
        }

        return new OAuthTokens('demo');
    }

    public function discoverAccounts(string $platform, OAuthTokens $tokens): array
    {
        return []; // o ConnectionManager usa o SandboxConnector para as contas de demonstração
    }
}
