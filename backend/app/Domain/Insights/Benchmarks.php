<?php

declare(strict_types=1);

namespace App\Domain\Insights;

/**
 * Faixas de referência por nicho (p25 / p50 / p75) para o mercado brasileiro.
 * Valores curados de partida — A VALIDAR com especialista de mídia (decisão em aberto nº 5 do
 * planejamento); depois passam a usar agregados anônimos da base, com amostra mínima.
 * Percentuais em 0–100, moeda em R$.
 */
final class Benchmarks
{
    public const SOURCE = 'Referência curada Delta (nov/2026), a validar por especialista';

    /** @var array<string, array{0: float, 1: float, 2: float}> padrão (nicho "outro") */
    private const BASE = [
        'meta_ads:ctr' => [0.7, 1.1, 1.7],
        'meta_ads:cpc' => [0.5, 0.9, 1.6],
        'meta_ads:cpm' => [12.0, 20.0, 32.0],
        'meta_ads:conversion_rate' => [1.0, 2.0, 3.5],
        'google_ads:ctr' => [2.5, 4.5, 7.0],
        'google_ads:avg_cpc' => [0.8, 1.6, 3.0],
        'google_ads:conversion_rate' => [2.0, 4.0, 7.0],
        'ga4:session_conversion_rate' => [0.8, 1.8, 3.5],
        'ga4:engagement_rate' => [45.0, 57.0, 68.0],
        'instagram:engagement_rate' => [1.0, 2.5, 5.0],
        'facebook:engagement_rate' => [0.5, 1.5, 3.5],
    ];

    /** @var array<string, array<string, array{0: float, 1: float, 2: float}>> ajustes por nicho */
    private const NICHES = [
        'ecommerce' => [
            'meta_ads:ctr' => [0.8, 1.2, 1.8],
            'meta_ads:conversion_rate' => [1.0, 1.8, 3.0],
            'ga4:session_conversion_rate' => [0.8, 1.5, 2.8],
        ],
        'infoproduto' => [
            'meta_ads:ctr' => [0.9, 1.4, 2.2],
            'meta_ads:cpm' => [15.0, 25.0, 40.0],
            'meta_ads:conversion_rate' => [0.8, 1.6, 3.0],
        ],
        'negocio_local' => [
            'meta_ads:cpm' => [8.0, 14.0, 24.0],
            'google_ads:ctr' => [3.5, 6.0, 9.0],
            'google_ads:conversion_rate' => [4.0, 7.0, 12.0],
        ],
        'b2b' => [
            'meta_ads:ctr' => [0.5, 0.8, 1.2],
            'meta_ads:cpc' => [1.0, 2.0, 3.5],
            'google_ads:avg_cpc' => [2.0, 4.0, 8.0],
            'google_ads:conversion_rate' => [1.5, 3.0, 5.5],
        ],
        'restaurante_delivery' => [
            'meta_ads:cpm' => [7.0, 12.0, 20.0],
            'meta_ads:ctr' => [1.0, 1.6, 2.4],
            'instagram:engagement_rate' => [1.5, 3.0, 6.0],
        ],
    ];

    /** @return array{p25: float, p50: float, p75: float, source: string}|null */
    public static function for(?string $niche, string $metric): ?array
    {
        $range = self::NICHES[$niche ?? ''][$metric] ?? self::BASE[$metric] ?? null;

        return $range === null ? null : ['p25' => $range[0], 'p50' => $range[1], 'p75' => $range[2], 'source' => self::SOURCE];
    }

    /** @return list<string> métricas com referência */
    public static function metrics(): array
    {
        return array_keys(self::BASE);
    }
}
