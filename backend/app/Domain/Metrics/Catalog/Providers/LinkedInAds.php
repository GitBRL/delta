<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog\Providers;

use App\Domain\Metrics\Catalog\MetricDirection as D;
use App\Domain\Metrics\Catalog\MetricSpec as M;
use App\Domain\Metrics\Catalog\MetricUnit as U;
use App\Domain\Metrics\Catalog\ProviderDefinition;

/** LinkedIn Ads (Marketing API, adAnalytics por conta). */
final class LinkedInAds implements ProviderDefinition
{
    public function key(): string
    {
        return 'linkedin_ads';
    }

    public function name(): string
    {
        return 'LinkedIn Ads';
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
            M::additive('linkedin_ads:spend', 'Investimento', 'Valor gasto nos anúncios no período, na moeda da conta.', U::Currency, D::Neutral, 2, featured: true),
            M::additive('linkedin_ads:impressions', 'Impressões', 'Quantas vezes os anúncios foram exibidos.'),
            M::additive('linkedin_ads:clicks', 'Cliques', 'Cliques nos anúncios.'),
            M::derived('linkedin_ads:ctr', 'CTR', 'Percentual de impressões que viraram clique.', 'linkedin_ads:clicks / linkedin_ads:impressions * 100', U::Percent, D::HigherIsBetter),
            M::derived('linkedin_ads:cpc', 'CPC', 'Custo médio por clique.', 'linkedin_ads:spend / linkedin_ads:clicks', U::Currency, D::LowerIsBetter),
            M::derived('linkedin_ads:cpm', 'CPM', 'Custo por mil impressões.', 'linkedin_ads:spend / linkedin_ads:impressions * 1000', U::Currency, D::LowerIsBetter),
            M::additive('linkedin_ads:engagements', 'Engajamentos', 'Cliques, reações, comentários, compartilhamentos e seguidores vindos dos anúncios.'),
            M::derived('linkedin_ads:engagement_rate', 'Taxa de engajamento', 'Engajamentos divididos pelas impressões.', 'linkedin_ads:engagements / linkedin_ads:impressions * 100', U::Percent, D::HigherIsBetter),
            M::additive('linkedin_ads:leads', 'Leads (formulário nativo)', 'Formulários de geração de leads enviados no próprio LinkedIn.', featured: true),
            M::derived('linkedin_ads:cpl', 'Custo por lead (CPL)', 'Investimento dividido pelos leads.', 'linkedin_ads:spend / linkedin_ads:leads', U::Currency, D::LowerIsBetter, featured: true),
            M::additive('linkedin_ads:conversions', 'Conversões no site', 'Conversões registradas pela Insight Tag no site.'),
            M::derived('linkedin_ads:cpa', 'Custo por conversão (CPA)', 'Investimento dividido pelas conversões no site.', 'linkedin_ads:spend / linkedin_ads:conversions', U::Currency, D::LowerIsBetter),
        ];
    }
}
