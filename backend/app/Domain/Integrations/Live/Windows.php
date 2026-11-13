<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Live;

use Carbon\CarbonImmutable;

/** Utilitários dos coletores: janelas de datas e leitura de séries de insights da Meta. */
final class Windows
{
    /** @return list<array{0: CarbonImmutable, 1: CarbonImmutable}> */
    public static function of(CarbonImmutable $from, CarbonImmutable $to, int $days): array
    {
        $windows = [];
        for ($start = $from; $start->lte($to); $start = $start->addDays($days)) {
            $end = $start->addDays($days - 1);
            $windows[] = [$start, $end->gt($to) ? $to : $end];
        }

        return $windows;
    }

    /**
     * Série "period=day" da Graph API: end_time é o fim do dia (meia-noite do dia seguinte, no fuso da conta).
     *
     * @param  array<string, mixed>  $response
     * @return list<array{0: string, 1: float}>
     */
    public static function insightValues(array $response): array
    {
        $out = [];
        $values = data_get($response, 'data.0.values');
        foreach (is_array($values) ? $values : [] as $point) {
            $end = is_array($point) ? ($point['end_time'] ?? null) : null;
            $value = is_array($point) ? MetaAdsConnector::num($point['value'] ?? null) : null;
            if (is_string($end) && $value !== null) {
                $out[] = [CarbonImmutable::parse($end)->subDay()->toDateString(), $value];
            }
        }

        return $out;
    }

    /**
     * Conta itens por dia (publicações), incluindo zeros nos dias sem nada.
     *
     * @param  list<mixed>  $timestamps
     * @return iterable<array{metric: string, date: string, value: float}>
     */
    public static function countByDay(array $timestamps, string $metric, CarbonImmutable $from, CarbonImmutable $to, string $timezone): iterable
    {
        $counts = [];
        foreach ($timestamps as $ts) {
            if (is_string($ts)) {
                $day = CarbonImmutable::parse($ts)->setTimezone($timezone)->toDateString();
                $counts[$day] = ($counts[$day] ?? 0) + 1;
            }
        }

        for ($day = $from; $day->lte($to); $day = $day->addDay()) {
            yield ['metric' => $metric, 'date' => $day->toDateString(), 'value' => (float) ($counts[$day->toDateString()] ?? 0)];
        }
    }
}
