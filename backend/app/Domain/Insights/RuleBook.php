<?php

declare(strict_types=1);

namespace App\Domain\Insights;

use App\Domain\Insights\RuleContext as W;
use App\Domain\Insights\Rules\CallbackRule;
use App\Domain\Insights\Rules\ChangeRule;
use App\Domain\Insights\Rules\ThresholdRule;

/**
 * Catálogo inicial de regras (§7.3 do plano).
 *
 * Os limites são PONTOS DE PARTIDA de boas práticas de mídia, a validar com um especialista
 * antes do lançamento e, depois, ajustáveis por agência e por nicho.
 */
final class RuleBook
{
    /** @return list<Rule> */
    public static function all(): array
    {
        return [
            ...self::metaAds(),
            ...self::googleAds(),
            self::cpaTarget('tiktok_ads', 'tiktok_ads:cpa', 'tiktok_ads:conversions'),
            self::cpaTarget('linkedin_ads', 'linkedin_ads:cpa', 'linkedin_ads:conversions'),
            ...self::ga4(),
            ...self::social(),
        ];
    }

    /** @return list<Rule> */
    private static function metaAds(): array
    {
        return [
            new ThresholdRule(
                id: 'meta_ads.frequency_high',
                metric: 'meta_ads:frequency', above: true, attention: 3.0, critical: 4.0,
                window: W::LAST_7, minVolume: ['meta_ads:impressions' => 1000],
                title: 'Público saturando',
                explanation: 'Frequência de {value} nos últimos 7 dias. Acima de {threshold}, as mesmas pessoas veem o anúncio vezes demais e o desempenho tende a cair.',
                suggestion: 'Renove os criativos, amplie o público ou exclua quem já converteu.',
            ),
            new ThresholdRule(
                id: 'meta_ads.ctr_low',
                metric: 'meta_ads:ctr', above: false, attention: 0.8, critical: 0.5,
                minVolume: ['meta_ads:impressions' => 5000],
                title: 'Poucos cliques nos anúncios',
                explanation: 'CTR de {value} no período, abaixo de {threshold}.',
                suggestion: 'Teste novos ganchos nos primeiros segundos do criativo e revise oferta e público.',
            ),
            new ChangeRule(
                id: 'meta_ads.cpm_up',
                metric: 'meta_ads:cpm', worseWhenUp: true, attentionPct: 30, criticalPct: 50,
                minVolume: ['meta_ads:impressions' => 5000],
                title: 'Custo por mil impressões subiu',
                explanation: 'CPM foi de {previous} para {value} ({change}) contra o período anterior.',
                suggestion: 'Verifique sazonalidade do leilão e sobreposição entre públicos; teste públicos mais amplos.',
            ),
            self::breakEvenRoas('meta_ads', 'meta_ads:roas', 'meta_ads:spend'),
            self::cpaTarget('meta_ads', 'meta_ads:cpa', 'meta_ads:conversions'),
            new CallbackRule('meta_ads.conversions_missing', 'meta_ads', ['meta_ads:conversions', 'meta_ads:link_clicks'], function (W $c, string $id): ?Signal {
                $clicks = $c->value('meta_ads:link_clicks', W::LAST_3);
                $conversions = $c->value('meta_ads:conversions', W::LAST_3);
                $before = $c->previous('meta_ads:conversions', W::LAST_3);

                if ($clicks === null || $clicks < 100 || $conversions !== 0.0 || ($before ?? 0.0) <= 0) {
                    return null;
                }

                return new Signal($id, 'meta_ads:conversions', SignalStatus::Critical,
                    'Conversões pararam de ser registradas',
                    sprintf('Zero conversões nos últimos 3 dias com %s cliques no link, depois de %s conversões nos 3 dias anteriores.', $c->format('meta_ads:link_clicks', $clicks), $c->format('meta_ads:conversions', $before)),
                    'Provável problema de rastreamento: confira o pixel/API de conversões e se o checkout ou formulário está funcionando.',
                    ['clicks' => $clicks, 'conversions' => $conversions, 'previous_conversions' => $before]);
            }),
        ];
    }

    /** @return list<Rule> */
    private static function googleAds(): array
    {
        return [
            new ThresholdRule(
                id: 'google_ads.ctr_low',
                metric: 'google_ads:ctr', above: false, attention: 2.0, critical: 1.0,
                minVolume: ['google_ads:impressions' => 5000],
                title: 'Anúncios de pesquisa pouco clicados',
                explanation: 'CTR de {value} no período, abaixo de {threshold}.',
                suggestion: 'Revise a relevância dos anúncios para as palavras-chave e negative termos sem intenção de compra.',
            ),
            new ThresholdRule(
                id: 'google_ads.impression_share_low',
                metric: 'google_ads:search_impression_share', above: false, attention: 50.0, critical: null,
                statusOverride: SignalStatus::Opportunity,
                title: 'Demanda não atendida na pesquisa',
                explanation: 'A conta aparece em {value} das buscas em que poderia aparecer (referência: {threshold}).',
                suggestion: 'Se o CPA está dentro da meta, aumente orçamento ou lances das campanhas limitadas para capturar essa demanda.',
            ),
            self::breakEvenRoas('google_ads', 'google_ads:roas', 'google_ads:cost'),
            self::cpaTarget('google_ads', 'google_ads:cpa', 'google_ads:conversions'),
        ];
    }

    /** @return list<Rule> */
    private static function ga4(): array
    {
        return [
            new CallbackRule('ga4.key_events_drop', 'ga4', ['ga4:key_events', 'ga4:sessions'], function (W $c, string $id): ?Signal {
                $events = $c->change('ga4:key_events');
                $sessions = $c->change('ga4:sessions');
                $before = $c->previous('ga4:key_events');

                if ($events === null || $sessions === null || ($before ?? 0.0) < 20 || $events > -50 || $sessions < -20) {
                    return null;
                }

                return new Signal($id, 'ga4:key_events', SignalStatus::Critical,
                    'Conversões do site despencaram sem queda de tráfego',
                    sprintf('Eventos-chave caíram %s enquanto as sessões variaram %s.', W::formatChange($events), W::formatChange($sessions)),
                    'Provável tag ou evento quebrado: confira o Google Tag Manager, o consent mode e se a página de conclusão mudou.',
                    ['key_events_change_pct' => $events, 'sessions_change_pct' => $sessions]);
            }),
            new ThresholdRule(
                id: 'ga4.engagement_low',
                metric: 'ga4:engagement_rate', above: false, attention: 45.0, critical: 35.0,
                minVolume: ['ga4:sessions' => 500],
                title: 'Visitantes saindo sem interagir',
                explanation: 'Taxa de engajamento de {value}, abaixo de {threshold}.',
                suggestion: 'Revise velocidade e primeira dobra das páginas de entrada e a coerência entre anúncio e página.',
            ),
        ];
    }

    /** @return list<Rule> */
    private static function social(): array
    {
        $rules = [
            new ThresholdRule(
                id: 'instagram.posting_rhythm',
                metric: 'instagram:posts', above: false, attention: 3.0, critical: 1.0, window: W::LAST_7,
                title: 'Ritmo de publicação baixo',
                explanation: '{value} publicação(ões) nos últimos 7 dias; a referência é ao menos {threshold}.',
                suggestion: 'Monte um calendário editorial com ao menos 3 publicações por semana.',
            ),
        ];

        foreach (['instagram' => 'instagram:engagement_rate', 'facebook' => 'facebook:engagement_rate'] as $provider => $metric) {
            $rules[] = new ChangeRule(
                id: "{$provider}.engagement_drop",
                metric: $metric, worseWhenUp: false, attentionPct: 30, criticalPct: null,
                minVolume: ["{$provider}:reach" => 1000],
                title: 'Engajamento caiu',
                explanation: 'Taxa de engajamento foi de {previous} para {value} ({change}).',
                suggestion: 'Compare os formatos e temas das publicações recentes com os que mais engajaram e repita o que funciona.',
            );
        }

        return $rules;
    }

    private static function breakEvenRoas(string $provider, string $roas, string $spend): Rule
    {
        return new CallbackRule("{$provider}.roas_below_breakeven", $provider, [$roas, $spend], function (W $c, string $id) use ($roas, $spend): ?Signal {
            $value = $c->value($roas);
            $breakEven = $c->goals->breakEvenRoas();

            if ($value === null || ($c->value($spend) ?? 0.0) < 100 || $value >= $breakEven) {
                return null;
            }

            $basis = $c->goals->grossMarginPct === null
                ? 'abaixo de 1 (receita atribuída menor que o investimento)'
                : sprintf('abaixo do ROAS de equilíbrio de %s para a margem de %s%%', $c->format($roas, $breakEven), W::decimal($c->goals->grossMarginPct, 0));

            return new Signal($id, $roas, SignalStatus::Critical,
                'Campanhas dando prejuízo',
                sprintf('ROAS de %s, %s.', $c->format($roas, $value), $basis),
                'Pause ou reduza o que está abaixo do equilíbrio e concentre verba nas campanhas e públicos com melhor retorno.',
                ['value' => $value, 'break_even' => $breakEven]);
        });
    }

    private static function cpaTarget(string $provider, string $cpa, string $conversions): Rule
    {
        return new CallbackRule("{$provider}.cpa_high", $provider, [$cpa, $conversions], function (W $c, string $id) use ($cpa, $conversions): ?Signal {
            $value = $c->value($cpa);
            if ($value === null || ($c->value($conversions) ?? 0.0) < 10) {
                return null;
            }

            $target = $c->goals->targetCpa;
            if ($target !== null) {
                if ($value <= $target) {
                    return null;
                }

                return new Signal($id, $cpa, $value > $target * 1.2 ? SignalStatus::Critical : SignalStatus::Attention,
                    'Custo por conversão acima da meta',
                    sprintf('CPA de %s contra a meta de %s.', $c->format($cpa, $value), $c->format($cpa, $target)),
                    'Mova verba para as campanhas e conjuntos com CPA abaixo da meta e revise os que estão acima.',
                    ['value' => $value, 'target' => $target]);
            }

            $change = $c->change($cpa);
            if ($change === null || $change < 20) {
                return null;
            }

            return new Signal($id, $cpa, SignalStatus::Attention,
                'Custo por conversão subindo',
                sprintf('CPA foi de %s para %s (%s). Defina a meta de CPA do projeto para alertas mais precisos.', $c->format($cpa, $c->previous($cpa)), $c->format($cpa, $value), W::formatChange($change)),
                'Veja quais campanhas puxaram a alta e se a taxa de conversão do site caiu no mesmo período.',
                ['value' => $value, 'previous' => $c->previous($cpa), 'change_pct' => $change]);
        });
    }
}
