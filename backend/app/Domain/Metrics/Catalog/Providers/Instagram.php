<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog\Providers;

use App\Domain\Metrics\Catalog\MetricDirection as D;
use App\Domain\Metrics\Catalog\MetricSpec as M;
use App\Domain\Metrics\Catalog\MetricUnit as U;
use App\Domain\Metrics\Catalog\ProviderDefinition;

final class Instagram implements ProviderDefinition
{
    public function key(): string
    {
        return 'instagram';
    }

    public function name(): string
    {
        return 'Instagram';
    }

    public function category(): string
    {
        return 'social';
    }

    public function accountKind(): string
    {
        return 'profile';
    }

    public function metrics(): array
    {
        return [
            M::snapshot('instagram:followers', 'Seguidores', 'Total de seguidores no fim do período.', featured: true),
            M::additive('instagram:follows', 'Novos seguidores', 'Pessoas que começaram a seguir o perfil no período.'),
            M::additive('instagram:views', 'Visualizações', 'Quantas vezes o conteúdo foi exibido.'),
            M::nonAdditive('instagram:reach', 'Alcance', 'Contas únicas que viram o conteúdo no período. Não é a soma dos dias.', featured: true),
            M::additive('instagram:interactions', 'Interações', 'Curtidas, comentários, compartilhamentos e salvamentos.'),
            M::derived('instagram:engagement_rate', 'Taxa de engajamento', 'Interações sobre o alcance.', 'instagram:interactions / instagram:reach * 100', U::Percent, D::HigherIsBetter, featured: true),
            M::additive('instagram:posts', 'Publicações', 'Posts, reels e carrosséis publicados.', featured: true),
        ];
    }
}
