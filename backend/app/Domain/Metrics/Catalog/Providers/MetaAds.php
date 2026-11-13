<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog\Providers;

use App\Domain\Metrics\Catalog\MetricDirection as D;
use App\Domain\Metrics\Catalog\MetricSpec as M;
use App\Domain\Metrics\Catalog\MetricUnit as U;
use App\Domain\Metrics\Catalog\ProviderDefinition;

final class MetaAds implements ProviderDefinition
{
    public function key(): string
    {
        return 'meta_ads';
    }

    public function name(): string
    {
        return 'Meta Ads';
    }

    public function category(): string
    {
        return 'ads';
    }

    public function accountKind(): string
    {
        return 'ad_account';
    }

    public function metrics(): array
    {
        return [
            M::additive('meta_ads:spend', 'Investimento', 'Valor gasto nos anúncios no período.', U::Currency, D::Neutral, 2, featured: true),
            M::additive('meta_ads:impressions', 'Impressões', 'Quantas vezes os anúncios foram exibidos.'),
            M::nonAdditive('meta_ads:reach', 'Alcance', 'Pessoas únicas que viram os anúncios ao menos uma vez no período. Não é a soma dos dias.'),
            M::derived('meta_ads:frequency', 'Frequência', 'Média de vezes que cada pessoa viu os anúncios. Acima de 3 em 7 dias o público tende a saturar.', 'meta_ads:impressions / meta_ads:reach', U::Decimal, D::Neutral),
            M::additive('meta_ads:link_clicks', 'Cliques no link', 'Cliques que levaram para o destino do anúncio.'),
            M::derived('meta_ads:ctr', 'CTR (link)', 'Percentual de impressões que viraram clique no link.', 'meta_ads:link_clicks / meta_ads:impressions * 100', U::Percent, D::HigherIsBetter),
            M::derived('meta_ads:cpc', 'CPC (link)', 'Custo médio por clique no link.', 'meta_ads:spend / meta_ads:link_clicks', U::Currency, D::LowerIsBetter),
            M::derived('meta_ads:cpm', 'CPM', 'Custo por mil impressões.', 'meta_ads:spend / meta_ads:impressions * 1000', U::Currency, D::LowerIsBetter),
            M::additive('meta_ads:conversions', 'Conversões', 'Compras atribuídas aos anúncios.', featured: true),
            M::derived('meta_ads:conversion_rate', 'Taxa de conversão', 'Percentual de cliques no link que viraram conversão.', 'meta_ads:conversions / meta_ads:link_clicks * 100', U::Percent, D::HigherIsBetter),
            M::derived('meta_ads:cpa', 'Custo por conversão (CPA)', 'Investimento dividido pelas conversões.', 'meta_ads:spend / meta_ads:conversions', U::Currency, D::LowerIsBetter, featured: true),
            M::additive('meta_ads:conversion_value', 'Valor de conversão', 'Receita atribuída às conversões.', U::Currency, D::HigherIsBetter, 2),
            M::derived('meta_ads:roas', 'ROAS', 'Receita gerada para cada real investido.', 'meta_ads:conversion_value / meta_ads:spend', U::Decimal, D::HigherIsBetter, featured: true),
            M::additive('meta_ads:leads', 'Leads', 'Cadastros gerados por formulários e mensagens.'),
            M::derived('meta_ads:cpl', 'Custo por lead (CPL)', 'Investimento dividido pelos leads.', 'meta_ads:spend / meta_ads:leads', U::Currency, D::LowerIsBetter),
        ];
    }
}
