<?php

declare(strict_types=1);

namespace App\Domain\Integrations\OAuth;

use Carbon\CarbonImmutable;

/** Tokens de uma autorização OAuth. Guardados criptografados em connections.credentials. */
final readonly class OAuthTokens
{
    /** @param list<string> $scopes */
    public function __construct(
        public string $accessToken,
        public ?string $refreshToken = null,
        public ?CarbonImmutable $expiresAt = null,
        public array $scopes = [],
    ) {}

    /** @param list<string> $scopes */
    public static function expiringIn(string $accessToken, mixed $seconds, ?string $refreshToken = null, array $scopes = []): self
    {
        $expiresAt = is_numeric($seconds) && (int) $seconds > 0 ? CarbonImmutable::now()->addSeconds((int) $seconds) : null;

        return new self($accessToken, $refreshToken, $expiresAt, $scopes);
    }

    /** @return array{access_token: string, refresh_token: string|null, expires_at: string|null, scopes: list<string>} */
    public function toCredentials(): array
    {
        return [
            'access_token' => $this->accessToken,
            'refresh_token' => $this->refreshToken,
            'expires_at' => $this->expiresAt?->toIso8601String(),
            'scopes' => $this->scopes,
        ];
    }
}
