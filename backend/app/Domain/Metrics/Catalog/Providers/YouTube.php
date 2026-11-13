<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog\Providers;

use App\Domain\Metrics\Catalog\MetricDirection as D;
use App\Domain\Metrics\Catalog\MetricSpec as M;
use App\Domain\Metrics\Catalog\MetricUnit as U;
use App\Domain\Metrics\Catalog\ProviderDefinition;

final class YouTube implements ProviderDefinition
{
    public function key(): string
    {
        return 'youtube';
    }

    public function name(): string
    {
        return 'YouTube';
    }

    public function category(): string
    {
        return 'social';
    }

    public function accountKind(): string
    {
        return 'channel';
    }

    public function metrics(): array
    {
        return [
            M::additive('youtube:views', 'Visualizações', 'Visualizações dos vídeos do canal.', featured: true),
            M::additive('youtube:watch_minutes', 'Minutos assistidos', 'Tempo total assistido, em minutos.', featured: true),
            M::derived('youtube:avg_view_minutes', 'Minutos por visualização', 'Tempo médio assistido em cada visualização.', 'youtube:watch_minutes / youtube:views', U::Decimal, D::HigherIsBetter, 1),
            M::snapshot('youtube:subscribers', 'Inscritos', 'Total de inscritos no canal ao fim do período.', featured: true),
            M::additive('youtube:subscribers_gained', 'Novos inscritos', 'Inscrições ganhas no período.'),
            M::additive('youtube:subscribers_lost', 'Inscrições perdidas', 'Cancelamentos de inscrição no período.', direction: D::LowerIsBetter),
            M::derived('youtube:net_subscribers', 'Saldo de inscritos', 'Novos inscritos menos cancelamentos.', 'youtube:subscribers_gained - youtube:subscribers_lost', U::Count, D::HigherIsBetter, 0, featured: true),
            M::additive('youtube:likes', 'Curtidas', 'Curtidas nos vídeos.'),
            M::additive('youtube:comments', 'Comentários', 'Comentários nos vídeos.'),
            M::additive('youtube:shares', 'Compartilhamentos', 'Compartilhamentos dos vídeos.'),
            M::derived('youtube:engagement_rate', 'Taxa de engajamento', 'Curtidas, comentários e compartilhamentos por visualização.', '(youtube:likes + youtube:comments + youtube:shares) / youtube:views * 100', U::Percent, D::HigherIsBetter, 2),
        ];
    }
}
