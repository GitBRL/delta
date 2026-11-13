<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Custom;

/**
 * Biblioteca de indicadores prontos. As combinações entre plataformas usam sum(): um projeto
 * só com Meta Ads ainda tem "investimento total" (o Google ausente não anula o resultado).
 */
final class CustomMetricTemplates
{
    /** @return list<array{name: string, description: string, formula: string, unit: string, direction: string, decimals: int}> */
    public static function all(): array
    {
        return [
            [
                'name' => 'Investimento total em mídia',
                'description' => 'Meta Ads + Google Ads.',
                'formula' => 'sum(meta_ads:spend, google_ads:cost)',
                'unit' => 'currency', 'direction' => 'neutral', 'decimals' => 2,
            ],
            [
                'name' => 'ROAS combinado',
                'description' => 'Receita atribuída nas duas plataformas para cada real investido nelas.',
                'formula' => 'sum(meta_ads:conversion_value, google_ads:conversion_value) / sum(meta_ads:spend, google_ads:cost)',
                'unit' => 'decimal', 'direction' => 'higher_is_better', 'decimals' => 2,
            ],
            [
                'name' => 'CPA combinado',
                'description' => 'Investimento total dividido pelas conversões das duas plataformas.',
                'formula' => 'sum(meta_ads:spend, google_ads:cost) / sum(meta_ads:conversions, google_ads:conversions)',
                'unit' => 'currency', 'direction' => 'lower_is_better', 'decimals' => 2,
            ],
            [
                'name' => 'MER (eficiência de marketing)',
                'description' => 'Receita total do site (GA4) sobre o investimento total em mídia. Não depende de atribuição.',
                'formula' => 'ga4:purchase_revenue / sum(meta_ads:spend, google_ads:cost)',
                'unit' => 'decimal', 'direction' => 'higher_is_better', 'decimals' => 2,
            ],
            [
                'name' => 'Custo por sessão',
                'description' => 'Quanto custou, em mídia paga, cada visita ao site.',
                'formula' => 'sum(meta_ads:spend, google_ads:cost) / ga4:sessions',
                'unit' => 'currency', 'direction' => 'lower_is_better', 'decimals' => 2,
            ],
            [
                'name' => 'Receita por sessão',
                'description' => 'Receita do site dividida pelas sessões.',
                'formula' => 'ga4:purchase_revenue / ga4:sessions',
                'unit' => 'currency', 'direction' => 'higher_is_better', 'decimals' => 2,
            ],
            [
                'name' => 'Custo por novo seguidor',
                'description' => 'Investimento no Meta Ads dividido pelos novos seguidores do Instagram.',
                'formula' => 'meta_ads:spend / instagram:follows',
                'unit' => 'currency', 'direction' => 'lower_is_better', 'decimals' => 2,
            ],
            [
                'name' => 'Alcance social total',
                'description' => 'Instagram + Facebook. Estimativa: a mesma pessoa pode estar nos dois.',
                'formula' => 'sum(instagram:reach, facebook:reach)',
                'unit' => 'count', 'direction' => 'higher_is_better', 'decimals' => 0,
            ],
        ];
    }
}
