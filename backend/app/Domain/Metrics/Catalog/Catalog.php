<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog;

use App\Domain\Metrics\Catalog\Providers\Facebook;
use App\Domain\Metrics\Catalog\Providers\Ga4;
use App\Domain\Metrics\Catalog\Providers\GoogleAds;
use App\Domain\Metrics\Catalog\Providers\GoogleBusiness;
use App\Domain\Metrics\Catalog\Providers\Instagram;
use App\Domain\Metrics\Catalog\Providers\LinkedInAds;
use App\Domain\Metrics\Catalog\Providers\MetaAds;
use App\Domain\Metrics\Catalog\Providers\SearchConsole;
use App\Domain\Metrics\Catalog\Providers\TikTokAds;
use App\Domain\Metrics\Catalog\Providers\YouTube;
use App\Domain\Metrics\Formula\Formula;
use App\Domain\Metrics\Formula\FormulaException;

/**
 * Catálogo de métricas em memória (fonte da verdade, versionada no código).
 * A tabela metric_definitions é uma cópia sincronizada para consultas e chaves estrangeiras.
 */
final class Catalog
{
    /** @var array<string, ProviderDefinition>|null */
    private ?array $providers = null;

    /** @var array<string, MetricSpec>|null */
    private ?array $metrics = null;

    /** @var array<string, Formula> */
    private array $formulas = [];

    /** @return array<string, ProviderDefinition> */
    public function providers(): array
    {
        if ($this->providers === null) {
            $this->providers = [];
            foreach ([new MetaAds, new GoogleAds, new Ga4, new Instagram, new Facebook, new SearchConsole, new YouTube, new GoogleBusiness, new TikTokAds, new LinkedInAds] as $provider) {
                $this->providers[$provider->key()] = $provider;
            }
        }

        return $this->providers;
    }

    public function provider(string $key): ?ProviderDefinition
    {
        return $this->providers()[$key] ?? null;
    }

    /** @return array<string, MetricSpec> */
    public function metrics(): array
    {
        if ($this->metrics === null) {
            $this->metrics = [];
            foreach ($this->providers() as $provider) {
                foreach ($provider->metrics() as $metric) {
                    $this->metrics[$metric->key] = $metric;
                }
            }
        }

        return $this->metrics;
    }

    public function metric(string $key): ?MetricSpec
    {
        return $this->metrics()[$key] ?? null;
    }

    public function formula(MetricSpec $metric): Formula
    {
        if ($metric->formula === null) {
            throw new FormulaException("A métrica {$metric->key} não é derivada.");
        }

        return $this->formulas[$metric->key] ??= Formula::parse($metric->formula);
    }

    /**
     * Métricas armazenadas necessárias para calcular $keys (só catálogo).
     *
     * @param  list<string>  $keys
     * @return list<string>
     */
    public function baseMetricsFor(array $keys): array
    {
        return (new MetricSet($this))->baseMetricsFor($keys);
    }
}
