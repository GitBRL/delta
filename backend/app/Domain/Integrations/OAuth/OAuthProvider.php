<?php

declare(strict_types=1);

namespace App\Domain\Integrations\OAuth;

use App\Domain\Integrations\DiscoveredAccount;

/**
 * Login de uma plataforma (um "app" OAuth pode servir a várias plataformas de dados:
 * o app da Meta serve Meta Ads, Facebook e Instagram, com escopos diferentes).
 */
interface OAuthProvider
{
    /** Credenciais do app configuradas no servidor? */
    public function isConfigured(string $platform): bool;

    /** Usa PKCE (S256)? */
    public function usesPkce(): bool;

    public function authorizationUrl(string $platform, string $state, string $redirectUri, ?string $codeChallenge): string;

    /** Troca o código de autorização por tokens. Lança OAuthException com mensagem para o usuário. */
    public function exchange(string $platform, string $code, string $redirectUri, ?string $codeVerifier): OAuthTokens;

    /** @return list<DiscoveredAccount> contas que a autorização dá acesso */
    public function discoverAccounts(string $platform, OAuthTokens $tokens): array;
}
