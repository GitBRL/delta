<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog;

/** Uma plataforma de dados (Meta Ads, GA4...) e as métricas que ela oferece. */
interface ProviderDefinition
{
    public function key(): string;

    public function name(): string;

    /** @return 'ads'|'social'|'analytics'|'seo'|'local' */
    public function category(): string;

    /** Tipo de conta descoberto na conexão. */
    public function accountKind(): string;

    /** @return list<MetricSpec> */
    public function metrics(): array;
}
