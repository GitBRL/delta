<?php

declare(strict_types=1);

namespace App\Domain\Reports;

use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Modelos de relatório por nicho (versionados no código, como o catálogo de métricas).
 * Cada modelo define o que importa em cada canal; ao criar o relatório, só entram as seções
 * dos canais ligados ao projeto (sem nenhum ligado, entram todas, para o relatório já nascer
 * pronto quando as contas forem conectadas).
 */
final class ReportTemplates
{
    private const PROVIDER_TITLES = [
        'meta_ads' => 'Meta Ads',
        'google_ads' => 'Google Ads',
        'ga4' => 'Site (Google Analytics 4)',
        'instagram' => 'Instagram',
        'facebook' => 'Facebook',
        'search_console' => 'Busca orgânica (Search Console)',
        'youtube' => 'YouTube',
        'google_business' => 'Perfil da Empresa no Google',
        'tiktok_ads' => 'TikTok Ads',
        'linkedin_ads' => 'LinkedIn Ads',
    ];

    /** Seção padrão dos canais que o modelo não detalha (mesmo formato: KPIs, gráfico, tabela). */
    private const GENERIC_CHANNELS = [
        'search_console' => [['search_console:clicks', 'search_console:impressions', 'search_console:ctr', 'search_console:position'], 'search_console:clicks', []],
        'youtube' => [['youtube:views', 'youtube:watch_minutes', 'youtube:subscribers', 'youtube:net_subscribers'], 'youtube:views', ['youtube:likes', 'youtube:comments', 'youtube:shares', 'youtube:engagement_rate']],
        'google_business' => [['google_business:impressions', 'google_business:calls', 'google_business:website_clicks', 'google_business:directions'], 'google_business:impressions', ['google_business:actions', 'google_business:action_rate']],
        'tiktok_ads' => [['tiktok_ads:spend', 'tiktok_ads:conversions', 'tiktok_ads:cpa', 'tiktok_ads:video_views'], 'tiktok_ads:spend', ['tiktok_ads:impressions', 'tiktok_ads:reach', 'tiktok_ads:clicks', 'tiktok_ads:ctr', 'tiktok_ads:cpm', 'tiktok_ads:completion_rate']],
        'linkedin_ads' => [['linkedin_ads:spend', 'linkedin_ads:leads', 'linkedin_ads:cpl', 'linkedin_ads:ctr'], 'linkedin_ads:leads', ['linkedin_ads:impressions', 'linkedin_ads:clicks', 'linkedin_ads:cpc', 'linkedin_ads:cpm', 'linkedin_ads:engagement_rate', 'linkedin_ads:conversions', 'linkedin_ads:cpa']],
    ];

    /** Ordem das seções de canal. */
    private const PROVIDER_ORDER = ['meta_ads', 'google_ads', 'tiktok_ads', 'linkedin_ads', 'ga4', 'search_console', 'google_business', 'instagram', 'facebook', 'youtube'];

    /**
     * Por modelo: resumo (KPIs do topo) e, por canal, [métricas dos KPIs, métrica do gráfico, métricas da tabela].
     *
     * @var array<string, array{name: string, description: string, niche: string, summary: list<string>, channels: array<string, array{0: list<string>, 1: string, 2: list<string>}>}>
     */
    private const TEMPLATES = [
        'ecommerce' => [
            'name' => 'E-commerce',
            'description' => 'Vendas, receita e retorno sobre o investimento em mídia, com o funil do site.',
            'niche' => 'ecommerce',
            'summary' => ['meta_ads:spend', 'meta_ads:roas', 'google_ads:roas', 'ga4:purchase_revenue', 'ga4:session_conversion_rate'],
            'channels' => [
                'meta_ads' => [['meta_ads:spend', 'meta_ads:conversions', 'meta_ads:cpa', 'meta_ads:roas', 'meta_ads:conversion_value', 'meta_ads:ctr'], 'meta_ads:conversion_value', ['meta_ads:impressions', 'meta_ads:reach', 'meta_ads:frequency', 'meta_ads:link_clicks', 'meta_ads:cpc', 'meta_ads:cpm', 'meta_ads:conversion_rate']],
                'google_ads' => [['google_ads:cost', 'google_ads:conversions', 'google_ads:cpa', 'google_ads:roas', 'google_ads:conversion_value'], 'google_ads:conversion_value', ['google_ads:impressions', 'google_ads:clicks', 'google_ads:ctr', 'google_ads:avg_cpc', 'google_ads:conversion_rate', 'google_ads:search_impression_share']],
                'ga4' => [['ga4:sessions', 'ga4:total_users', 'ga4:session_conversion_rate', 'ga4:purchase_revenue'], 'ga4:purchase_revenue', ['ga4:new_users', 'ga4:engaged_sessions', 'ga4:engagement_rate', 'ga4:avg_engagement_time', 'ga4:key_events']],
                'instagram' => [['instagram:followers', 'instagram:reach', 'instagram:engagement_rate'], 'instagram:reach', ['instagram:views', 'instagram:interactions', 'instagram:posts', 'instagram:follows']],
                'facebook' => [['facebook:followers', 'facebook:reach', 'facebook:engagement_rate'], 'facebook:reach', ['facebook:views', 'facebook:engagements', 'facebook:posts']],
            ],
        ],
        'infoproduto' => [
            'name' => 'Infoproduto e lançamentos',
            'description' => 'Captação de leads, custo por lead e vendas, para lançamentos e perpétuo.',
            'niche' => 'infoproduto',
            'summary' => ['meta_ads:spend', 'meta_ads:leads', 'meta_ads:cpl', 'meta_ads:roas', 'ga4:key_events'],
            'channels' => [
                'meta_ads' => [['meta_ads:spend', 'meta_ads:leads', 'meta_ads:cpl', 'meta_ads:conversions', 'meta_ads:roas', 'meta_ads:frequency'], 'meta_ads:leads', ['meta_ads:impressions', 'meta_ads:reach', 'meta_ads:link_clicks', 'meta_ads:ctr', 'meta_ads:cpm', 'meta_ads:cpa']],
                'google_ads' => [['google_ads:cost', 'google_ads:conversions', 'google_ads:cpa', 'google_ads:roas'], 'google_ads:conversions', ['google_ads:clicks', 'google_ads:ctr', 'google_ads:avg_cpc', 'google_ads:conversion_rate']],
                'ga4' => [['ga4:sessions', 'ga4:key_events', 'ga4:session_conversion_rate'], 'ga4:sessions', ['ga4:total_users', 'ga4:new_users', 'ga4:engagement_rate', 'ga4:purchase_revenue']],
                'instagram' => [['instagram:followers', 'instagram:follows', 'instagram:reach', 'instagram:engagement_rate'], 'instagram:follows', ['instagram:views', 'instagram:interactions', 'instagram:posts']],
                'facebook' => [['facebook:reach', 'facebook:engagement_rate'], 'facebook:reach', ['facebook:followers', 'facebook:views', 'facebook:engagements', 'facebook:posts']],
            ],
        ],
        'negocio_local' => [
            'name' => 'Negócio local',
            'description' => 'Alcance na região, contatos gerados e custo por contato, com a presença nas redes.',
            'niche' => 'negocio_local',
            'summary' => ['meta_ads:spend', 'meta_ads:reach', 'meta_ads:conversions', 'meta_ads:cpa', 'instagram:followers'],
            'channels' => [
                'meta_ads' => [['meta_ads:spend', 'meta_ads:reach', 'meta_ads:frequency', 'meta_ads:conversions', 'meta_ads:cpa'], 'meta_ads:reach', ['meta_ads:impressions', 'meta_ads:link_clicks', 'meta_ads:ctr', 'meta_ads:cpc', 'meta_ads:cpm', 'meta_ads:leads']],
                'google_ads' => [['google_ads:cost', 'google_ads:clicks', 'google_ads:conversions', 'google_ads:cpa'], 'google_ads:conversions', ['google_ads:impressions', 'google_ads:ctr', 'google_ads:avg_cpc', 'google_ads:search_impression_share']],
                'ga4' => [['ga4:sessions', 'ga4:total_users', 'ga4:key_events'], 'ga4:sessions', ['ga4:new_users', 'ga4:engagement_rate', 'ga4:session_conversion_rate']],
                'instagram' => [['instagram:followers', 'instagram:reach', 'instagram:engagement_rate', 'instagram:posts'], 'instagram:reach', ['instagram:views', 'instagram:interactions', 'instagram:follows']],
                'facebook' => [['facebook:followers', 'facebook:reach', 'facebook:engagement_rate'], 'facebook:reach', ['facebook:views', 'facebook:engagements', 'facebook:posts']],
            ],
        ],
        'b2b' => [
            'name' => 'B2B e geração de leads',
            'description' => 'Leads qualificados, custo por lead e conversões do site para times de vendas.',
            'niche' => 'b2b',
            'summary' => ['google_ads:cost', 'google_ads:conversions', 'google_ads:cpa', 'meta_ads:leads', 'ga4:key_events'],
            'channels' => [
                'google_ads' => [['google_ads:cost', 'google_ads:conversions', 'google_ads:cpa', 'google_ads:conversion_rate', 'google_ads:search_impression_share'], 'google_ads:conversions', ['google_ads:impressions', 'google_ads:clicks', 'google_ads:ctr', 'google_ads:avg_cpc']],
                'meta_ads' => [['meta_ads:spend', 'meta_ads:leads', 'meta_ads:cpl', 'meta_ads:ctr'], 'meta_ads:leads', ['meta_ads:impressions', 'meta_ads:reach', 'meta_ads:frequency', 'meta_ads:link_clicks', 'meta_ads:cpm']],
                'ga4' => [['ga4:sessions', 'ga4:key_events', 'ga4:session_conversion_rate', 'ga4:engagement_rate'], 'ga4:key_events', ['ga4:total_users', 'ga4:new_users', 'ga4:avg_engagement_time']],
                'instagram' => [['instagram:followers', 'instagram:reach', 'instagram:engagement_rate'], 'instagram:reach', ['instagram:views', 'instagram:interactions', 'instagram:posts']],
                'facebook' => [['facebook:reach', 'facebook:engagement_rate'], 'facebook:reach', ['facebook:followers', 'facebook:views', 'facebook:posts']],
            ],
        ],
        'restaurante_delivery' => [
            'name' => 'Restaurante e delivery',
            'description' => 'Pedidos, custo por pedido e frequência dos anúncios, com o movimento nas redes.',
            'niche' => 'restaurante_delivery',
            'summary' => ['meta_ads:spend', 'meta_ads:conversions', 'meta_ads:cpa', 'meta_ads:frequency', 'instagram:reach'],
            'channels' => [
                'meta_ads' => [['meta_ads:spend', 'meta_ads:conversions', 'meta_ads:cpa', 'meta_ads:frequency', 'meta_ads:roas'], 'meta_ads:conversions', ['meta_ads:reach', 'meta_ads:impressions', 'meta_ads:link_clicks', 'meta_ads:ctr', 'meta_ads:cpm']],
                'instagram' => [['instagram:followers', 'instagram:reach', 'instagram:engagement_rate', 'instagram:posts'], 'instagram:reach', ['instagram:views', 'instagram:interactions', 'instagram:follows']],
                'facebook' => [['facebook:followers', 'facebook:reach', 'facebook:engagement_rate'], 'facebook:reach', ['facebook:views', 'facebook:engagements', 'facebook:posts']],
                'google_ads' => [['google_ads:cost', 'google_ads:conversions', 'google_ads:cpa'], 'google_ads:conversions', ['google_ads:clicks', 'google_ads:ctr', 'google_ads:avg_cpc']],
                'ga4' => [['ga4:sessions', 'ga4:key_events'], 'ga4:sessions', ['ga4:total_users', 'ga4:session_conversion_rate']],
            ],
        ],
        'redes_sociais' => [
            'name' => 'Redes sociais e marca',
            'description' => 'Crescimento de seguidores, alcance e engajamento do conteúdo orgânico.',
            'niche' => 'outro',
            'summary' => ['instagram:followers', 'instagram:reach', 'instagram:engagement_rate', 'facebook:reach', 'facebook:engagement_rate'],
            'channels' => [
                'instagram' => [['instagram:followers', 'instagram:follows', 'instagram:reach', 'instagram:engagement_rate', 'instagram:posts'], 'instagram:reach', ['instagram:views', 'instagram:interactions']],
                'facebook' => [['facebook:followers', 'facebook:reach', 'facebook:engagement_rate', 'facebook:posts'], 'facebook:reach', ['facebook:views', 'facebook:engagements']],
                'meta_ads' => [['meta_ads:spend', 'meta_ads:reach', 'meta_ads:frequency', 'meta_ads:cpm'], 'meta_ads:reach', ['meta_ads:impressions', 'meta_ads:link_clicks', 'meta_ads:ctr']],
                'ga4' => [['ga4:sessions', 'ga4:total_users', 'ga4:engagement_rate'], 'ga4:sessions', ['ga4:new_users', 'ga4:avg_engagement_time']],
                'google_ads' => [['google_ads:cost', 'google_ads:clicks', 'google_ads:ctr'], 'google_ads:clicks', ['google_ads:impressions', 'google_ads:avg_cpc']],
            ],
        ],
    ];

    /** @return list<array{key: string, name: string, description: string, niche: string, channels: list<string>}> */
    public static function all(): array
    {
        $out = [];
        foreach (self::TEMPLATES as $key => $t) {
            $out[] = ['key' => $key, 'name' => $t['name'], 'description' => $t['description'], 'niche' => $t['niche'], 'channels' => array_keys($t['channels'])];
        }

        return $out;
    }

    /** Modelo sugerido para o nicho do projeto. */
    public static function forNiche(?string $niche): string
    {
        foreach (self::TEMPLATES as $key => $t) {
            if ($t['niche'] === $niche) {
                return $key;
            }
        }

        return 'redes_sociais';
    }

    public static function exists(string $key): bool
    {
        return isset(self::TEMPLATES[$key]);
    }

    /**
     * Layout pronto para os canais do projeto.
     *
     * @param  list<string>  $providers  canais ligados ao projeto
     * @return array{sections: list<array{id: string, title: string, blocks: list<array<string, mixed>>}>}
     */
    public static function build(string $key, array $providers): array
    {
        $t = self::definition($key) ?? throw ValidationException::withMessages(['template' => 'Modelo de relatório desconhecido.']);
        $channels = $providers === [] ? self::PROVIDER_ORDER : array_values(array_intersect(self::PROVIDER_ORDER, $providers));

        $summary = array_values(array_filter($t['summary'], fn (string $m): bool => in_array(explode(':', $m)[0], $channels, true)));
        if ($summary === []) {
            // Canais fora do foco do modelo: resume com os KPIs principais deles.
            foreach ($channels as $channel) {
                $summary = [...$summary, ...array_slice($t['channels'][$channel][0] ?? [], 0, 2)];
            }
            $summary = array_slice($summary, 0, 6);
        }

        $sections = [[
            'id' => self::id('s'),
            'title' => 'Resumo do período',
            'blocks' => array_values(array_filter([
                ['id' => self::id('b'), 'type' => 'text', 'title' => 'Análise da agência', 'content' => "Escreva aqui os destaques do período: o que funcionou, o que mudou e os próximos passos.\n\n- Destaque 1\n- Destaque 2"],
                $summary === [] ? null : ['id' => self::id('b'), 'type' => 'kpis', 'title' => 'Números principais', 'metrics' => $summary],
                ['id' => self::id('b'), 'type' => 'attention', 'title' => 'Pontos de atenção e sugestões', 'limit' => 5],
            ])),
        ]];

        foreach ($channels as $channel) {
            [$kpis, $chart, $table] = $t['channels'][$channel] ?? self::GENERIC_CHANNELS[$channel] ?? [[], '', []];
            if ($kpis === []) {
                continue;
            }

            $sections[] = [
                'id' => self::id('s'),
                'title' => self::PROVIDER_TITLES[$channel],
                'blocks' => [
                    ['id' => self::id('b'), 'type' => 'kpis', 'metrics' => $kpis],
                    ['id' => self::id('b'), 'type' => 'chart', 'metric' => $chart],
                    ...($table === [] ? [] : [['id' => self::id('b'), 'type' => 'table', 'title' => 'Detalhamento', 'metrics' => $table]]),
                ],
            ];
        }

        return ['sections' => $sections];
    }

    /** @return array{name: string, description: string, niche: string, summary: list<string>, channels: array<string, array{0: list<string>, 1: string, 2: list<string>}>}|null */
    private static function definition(string $key): ?array
    {
        return self::TEMPLATES[$key] ?? null;
    }

    private static function id(string $prefix): string
    {
        return $prefix.Str::lower(Str::random(8));
    }
}
