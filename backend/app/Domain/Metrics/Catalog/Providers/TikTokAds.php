<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog\Providers;

use App\Domain\Metrics\Catalog\MetricDirection as D;
use App\Domain\Metrics\Catalog\MetricSpec as M;
use App\Domain\Metrics\Catalog\MetricUnit as U;
use App\Domain\Metrics\Catalog\ProviderDefinition;

/** TikTok Ads (Marketing API, relatório integrado por anunciante). */
final class TikTokAds implements ProviderDefinition
{
    public function key(): string
    {
        return 'tiktok_ads';
    }

    public function name(): string
    {
        return 'TikTok Ads';
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
            M::additive('tiktok_ads:spend', 'Investimento', 'Valor gasto nos anúncios no período.', U::Currency, D::Neutral, 2, featured: true),
            M::additive('tiktok_ads:impressions', 'Impressões', 'Quantas vezes os anúncios foram exibidos.'),
            M::nonAdditive('tiktok_ads:reach', 'Alcance', 'Pessoas únicas que viram os anúncios ao menos uma vez no período. Não é a soma dos dias.'),
            M::derived('tiktok_ads:frequency', 'Frequência', 'Média de vezes que cada pessoa viu os anúncios.', 'tiktok_ads:impressions / tiktok_ads:reach', U::Decimal, D::Neutral),
            M::additive('tiktok_ads:clicks', 'Cliques', 'Cliques que levaram para o destino do anúncio.'),
            M::derived('tiktok_ads:ctr', 'CTR', 'Percentual de impressões que viraram clique.', 'tiktok_ads:clicks / tiktok_ads:impressions * 100', U::Percent, D::HigherIsBetter),
            M::derived('tiktok_ads:cpc', 'CPC', 'Custo médio por clique.', 'tiktok_ads:spend / tiktok_ads:clicks', U::Currency, D::LowerIsBetter),
            M::derived('tiktok_ads:cpm', 'CPM', 'Custo por mil impressões.', 'tiktok_ads:spend / tiktok_ads:impressions * 1000', U::Currency, D::LowerIsBetter),
            M::additive('tiktok_ads:video_views', 'Visualizações de vídeo', 'Vezes que o vídeo do anúncio começou a tocar.', featured: true),
            M::additive('tiktok_ads:video_completions', 'Vídeos assistidos até o fim', 'Visualizações que chegaram a 100% do vídeo.'),
            M::derived('tiktok_ads:completion_rate', 'Taxa de conclusão', 'Percentual das visualizações que foram até o fim. Mostra se o criativo prende a atenção.', 'tiktok_ads:video_completions / tiktok_ads:video_views * 100', U::Percent, D::HigherIsBetter),
            M::additive('tiktok_ads:conversions', 'Conversões', 'Conversões do evento de otimização das campanhas.', featured: true),
            M::derived('tiktok_ads:conversion_rate', 'Taxa de conversão', 'Percentual de cliques que viraram conversão.', 'tiktok_ads:conversions / tiktok_ads:clicks * 100', U::Percent, D::HigherIsBetter),
            M::derived('tiktok_ads:cpa', 'Custo por conversão (CPA)', 'Investimento dividido pelas conversões.', 'tiktok_ads:spend / tiktok_ads:conversions', U::Currency, D::LowerIsBetter, featured: true),
        ];
    }
}
