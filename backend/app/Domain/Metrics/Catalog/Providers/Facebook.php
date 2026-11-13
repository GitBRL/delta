<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog\Providers;

use App\Domain\Metrics\Catalog\MetricDirection as D;
use App\Domain\Metrics\Catalog\MetricSpec as M;
use App\Domain\Metrics\Catalog\MetricUnit as U;
use App\Domain\Metrics\Catalog\ProviderDefinition;

final class Facebook implements ProviderDefinition
{
    public function key(): string
    {
        return 'facebook';
    }

    public function name(): string
    {
        return 'Facebook';
    }

    public function category(): string
    {
        return 'social';
    }

    public function accountKind(): string
    {
        return 'page';
    }

    public function metrics(): array
    {
        return [
            M::snapshot('facebook:followers', 'Seguidores da página', 'Total de seguidores no fim do período.', featured: true),
            M::additive('facebook:views', 'Visualizações', 'Quantas vezes o conteúdo da página foi exibido.'),
            M::nonAdditive('facebook:reach', 'Alcance', 'Pessoas únicas que viram o conteúdo no período. Não é a soma dos dias.', featured: true),
            M::additive('facebook:engagements', 'Engajamentos', 'Reações, comentários, compartilhamentos e cliques.'),
            M::derived('facebook:engagement_rate', 'Taxa de engajamento', 'Engajamentos sobre o alcance.', 'facebook:engagements / facebook:reach * 100', U::Percent, D::HigherIsBetter, featured: true),
            M::additive('facebook:posts', 'Publicações', 'Posts publicados na página.', featured: true),
        ];
    }
}
