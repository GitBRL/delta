<?php

declare(strict_types=1);

namespace App\Domain\Integrations;

final readonly class DiscoveredAccount
{
    public function __construct(
        public string $externalId,
        public string $name,
        public string $kind,
        public ?string $currency = null,
        public ?string $timezone = null,
    ) {}
}
