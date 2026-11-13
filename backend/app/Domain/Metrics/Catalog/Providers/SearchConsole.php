<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog\Providers;

use App\Domain\Metrics\Catalog\MetricDirection as D;
use App\Domain\Metrics\Catalog\MetricSpec as M;
use App\Domain\Metrics\Catalog\MetricUnit as U;
use App\Domain\Metrics\Catalog\ProviderDefinition;

final class SearchConsole implements ProviderDefinition
{
    public function key(): string
    {
        return 'search_console';
    }

    public function name(): string
    {
        return 'Google Search Console';
    }

    public function category(): string
    {
        return 'seo';
    }

    public function accountKind(): string
    {
        return 'site';
    }

    public function metrics(): array
    {
        return [
            M::additive('search_console:clicks', 'Cliques orgânicos', 'Cliques vindos da busca do Google.', featured: true),
            M::additive('search_console:impressions', 'Impressões na busca', 'Vezes que o site apareceu nos resultados do Google.', featured: true),
            M::derived('search_console:ctr', 'CTR orgânico', 'Percentual de impressões que viraram clique.', 'search_console:clicks / search_console:impressions * 100', U::Percent, D::HigherIsBetter, 2, featured: true),
            M::additive('search_console:position_sum', 'Soma de posições (componente interno)', 'Posição × impressões, para a média ponderada.', visible: false),
            M::derived('search_console:position', 'Posição média', 'Posição média nos resultados, ponderada pelas impressões (menor é melhor).', 'search_console:position_sum / search_console:impressions', U::Decimal, D::LowerIsBetter, 1, featured: true),
        ];
    }
}
