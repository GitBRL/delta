<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog\Providers;

use App\Domain\Metrics\Catalog\MetricDirection as D;
use App\Domain\Metrics\Catalog\MetricSpec as M;
use App\Domain\Metrics\Catalog\MetricUnit as U;
use App\Domain\Metrics\Catalog\ProviderDefinition;

final class GoogleAds implements ProviderDefinition
{
    public function key(): string
    {
        return 'google_ads';
    }

    public function name(): string
    {
        return 'Google Ads';
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
            M::additive('google_ads:cost', 'Investimento', 'Valor gasto nas campanhas no período.', U::Currency, D::Neutral, 2, featured: true),
            M::additive('google_ads:impressions', 'Impressões', 'Quantas vezes os anúncios foram exibidos.'),
            M::additive('google_ads:clicks', 'Cliques', 'Cliques nos anúncios.'),
            M::derived('google_ads:ctr', 'CTR', 'Percentual de impressões que viraram clique.', 'google_ads:clicks / google_ads:impressions * 100', U::Percent, D::HigherIsBetter),
            M::derived('google_ads:avg_cpc', 'CPC médio', 'Custo médio por clique.', 'google_ads:cost / google_ads:clicks', U::Currency, D::LowerIsBetter),
            M::additive('google_ads:conversions', 'Conversões', 'Ações de conversão registradas.', featured: true),
            M::derived('google_ads:conversion_rate', 'Taxa de conversão', 'Percentual de cliques que viraram conversão.', 'google_ads:conversions / google_ads:clicks * 100', U::Percent, D::HigherIsBetter),
            M::derived('google_ads:cpa', 'Custo por conversão', 'Investimento dividido pelas conversões.', 'google_ads:cost / google_ads:conversions', U::Currency, D::LowerIsBetter, featured: true),
            M::additive('google_ads:conversion_value', 'Valor de conversão', 'Receita atribuída às conversões.', U::Currency, D::HigherIsBetter, 2),
            M::derived('google_ads:roas', 'ROAS', 'Receita gerada para cada real investido.', 'google_ads:conversion_value / google_ads:cost', U::Decimal, D::HigherIsBetter, featured: true),
            M::nonAdditive('google_ads:search_impression_share', 'Parcela de impressões (pesquisa)', 'Impressões recebidas sobre as que a conta poderia receber. Calculada pela plataforma para o período.', U::Percent, 1),
        ];
    }
}
