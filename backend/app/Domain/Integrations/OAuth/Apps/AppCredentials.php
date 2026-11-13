<?php

declare(strict_types=1);

namespace App\Domain\Integrations\OAuth\Apps;

/** Credenciais efetivas de um app OAuth: as da agência ou, na falta delas, as do servidor. */
final readonly class AppCredentials
{
    /** @param 'agency'|'server' $source */
    public function __construct(
        public string $clientId,
        public string $clientSecret,
        public ?string $developerToken,
        public string $source,
    ) {}

    public function hasDeveloperToken(): bool
    {
        return $this->developerToken !== null && $this->developerToken !== '';
    }
}
