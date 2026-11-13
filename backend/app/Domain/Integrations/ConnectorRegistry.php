<?php

declare(strict_types=1);

namespace App\Domain\Integrations;

use App\Domain\Integrations\Live\FacebookPageConnector;
use App\Domain\Integrations\Live\Ga4Connector;
use App\Domain\Integrations\Live\GoogleAdsConnector;
use App\Domain\Integrations\Live\GoogleExtrasConnector;
use App\Domain\Integrations\Live\InstagramConnector;
use App\Domain\Integrations\Live\LinkedInAdsConnector;
use App\Domain\Integrations\Live\MetaAdsConnector;
use App\Domain\Integrations\Live\TikTokAdsConnector;
use App\Domain\Integrations\Sandbox\SandboxConnector;
use App\Domain\Metrics\Catalog\Catalog;
use App\Models\IntegrationConnection;

/**
 * Resolve o conector de uma conexão: demonstração ou o coletor real da plataforma.
 * Os coletores reais usam o app OAuth da agência (ADR 0009) e os tokens da conexão (ADR 0014).
 */
final readonly class ConnectorRegistry
{
    public function __construct(
        private Catalog $catalog,
        private SandboxConnector $sandbox,
    ) {}

    /** @var array<string, class-string<Connector>> */
    private const LIVE = [
        'meta_ads' => MetaAdsConnector::class,
        'facebook' => FacebookPageConnector::class,
        'instagram' => InstagramConnector::class,
        'ga4' => Ga4Connector::class,
        'google_ads' => GoogleAdsConnector::class,
        'search_console' => GoogleExtrasConnector::class,
        'youtube' => GoogleExtrasConnector::class,
        'google_business' => GoogleExtrasConnector::class,
        'tiktok_ads' => TikTokAdsConnector::class,
        'linkedin_ads' => LinkedInAdsConnector::class,
    ];

    public function for(IntegrationConnection $connection): Connector
    {
        if ($this->catalog->provider($connection->provider) === null) {
            throw ConnectorUnavailable::unknown($connection->provider);
        }

        if ($connection->isSandbox()) {
            return $this->sandbox;
        }

        $class = self::LIVE[$connection->provider] ?? throw ConnectorUnavailable::live($connection->provider);

        return app($class);
    }

    /** Coleta de dados reais implementada para a plataforma? */
    public function hasLiveConnector(string $provider): bool
    {
        return isset(self::LIVE[$provider]);
    }
}
