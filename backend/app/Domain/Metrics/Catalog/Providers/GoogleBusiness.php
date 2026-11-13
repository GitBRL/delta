<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog\Providers;

use App\Domain\Metrics\Catalog\MetricDirection as D;
use App\Domain\Metrics\Catalog\MetricSpec as M;
use App\Domain\Metrics\Catalog\MetricUnit as U;
use App\Domain\Metrics\Catalog\ProviderDefinition;

final class GoogleBusiness implements ProviderDefinition
{
    public function key(): string
    {
        return 'google_business';
    }

    public function name(): string
    {
        return 'Perfil da Empresa no Google';
    }

    public function category(): string
    {
        return 'local';
    }

    public function accountKind(): string
    {
        return 'location';
    }

    public function metrics(): array
    {
        return [
            M::additive('google_business:impressions', 'Visualizações do perfil', 'Vezes que o perfil apareceu na Busca e no Maps.', featured: true),
            M::additive('google_business:calls', 'Ligações', 'Cliques em "ligar" no perfil.', featured: true),
            M::additive('google_business:website_clicks', 'Cliques no site', 'Cliques para o site a partir do perfil.', featured: true),
            M::additive('google_business:directions', 'Pedidos de rota', 'Pessoas que pediram rota até o endereço.', featured: true),
            M::derived('google_business:actions', 'Ações no perfil', 'Ligações, cliques no site e pedidos de rota.', 'coalesce(google_business:calls, 0) + coalesce(google_business:website_clicks, 0) + coalesce(google_business:directions, 0)', U::Count, D::HigherIsBetter, 0),
            M::derived('google_business:action_rate', 'Taxa de ação', 'Ações por visualização do perfil.', 'google_business:actions / google_business:impressions * 100', U::Percent, D::HigherIsBetter, 2),
        ];
    }
}
