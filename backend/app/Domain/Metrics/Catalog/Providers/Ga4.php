<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog\Providers;

use App\Domain\Metrics\Catalog\MetricDirection as D;
use App\Domain\Metrics\Catalog\MetricSpec as M;
use App\Domain\Metrics\Catalog\MetricUnit as U;
use App\Domain\Metrics\Catalog\ProviderDefinition;

final class Ga4 implements ProviderDefinition
{
    public function key(): string
    {
        return 'ga4';
    }

    public function name(): string
    {
        return 'Google Analytics 4';
    }

    public function category(): string
    {
        return 'analytics';
    }

    public function accountKind(): string
    {
        return 'property';
    }

    public function metrics(): array
    {
        return [
            M::additive('ga4:sessions', 'Sessões', 'Visitas ao site ou app.', featured: true),
            M::nonAdditive('ga4:total_users', 'Usuários', 'Pessoas únicas no período. Não é a soma dos dias.', featured: true),
            M::additive('ga4:new_users', 'Novos usuários', 'Pessoas que visitaram pela primeira vez.'),
            M::additive('ga4:engaged_sessions', 'Sessões engajadas', 'Sessões com mais de 10 s, conversão ou 2+ páginas.'),
            M::derived('ga4:engagement_rate', 'Taxa de engajamento', 'Percentual de sessões engajadas.', 'ga4:engaged_sessions / ga4:sessions * 100', U::Percent, D::HigherIsBetter, 1),
            M::additive('ga4:engagement_duration', 'Tempo de engajamento total', 'Soma do tempo de engajamento (componente interno).', U::Duration, visible: false),
            M::derived('ga4:avg_engagement_time', 'Tempo médio de engajamento', 'Tempo médio de engajamento por sessão.', 'ga4:engagement_duration / ga4:sessions', U::Duration, D::HigherIsBetter, 0),
            M::additive('ga4:key_events', 'Eventos-chave', 'Conversões configuradas na propriedade.', featured: true),
            M::derived('ga4:session_conversion_rate', 'Taxa de conversão da sessão', 'Percentual de sessões com evento-chave.', 'ga4:key_events / ga4:sessions * 100', U::Percent, D::HigherIsBetter, featured: true),
            M::additive('ga4:purchase_revenue', 'Receita de compras', 'Receita registrada pelo e-commerce.', U::Currency, D::HigherIsBetter, 2),
            M::derived('ga4:sessions_per_user', 'Sessões por usuário', 'Quantas vezes, em média, cada pessoa voltou.', 'ga4:sessions / ga4:total_users', U::Decimal, D::HigherIsBetter),
        ];
    }
}
