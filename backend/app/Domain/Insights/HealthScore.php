<?php

declare(strict_types=1);

namespace App\Domain\Insights;

/**
 * Saúde da conta (0–100) de um projeto: parte de 100 e desconta pelos alertas abertos
 * (peso por severidade) e pelas metas fora do ritmo (§7.5 do planejamento).
 */
final class HealthScore
{
    private const PENALTY = ['critical' => 20, 'attention' => 8];

    private const GOAL_PENALTY = ['off_track' => 12, 'at_risk' => 5];

    /**
     * @param  array{summary: array{critical: int, attention: int, opportunity: int}}  $evaluation
     * @param  list<string>  $goalStatuses
     * @return array{score: int, level: 'good'|'fair'|'poor', factors: list<array{label: string, impact: int}>}
     */
    public static function compute(array $evaluation, array $goalStatuses = []): array
    {
        $factors = [];
        foreach (self::PENALTY as $status => $points) {
            $count = $evaluation['summary'][$status];
            if ($count > 0) {
                $factors[] = ['label' => $count.' '.($status === 'critical' ? 'alerta(s) crítico(s)' : 'ponto(s) de atenção'), 'impact' => -$points * $count];
            }
        }
        foreach (self::GOAL_PENALTY as $status => $points) {
            $count = count(array_filter($goalStatuses, fn (string $s): bool => $s === $status));
            if ($count > 0) {
                $factors[] = ['label' => $count.' meta(s) '.($status === 'off_track' ? 'fora do ritmo' : 'em risco'), 'impact' => -$points * $count];
            }
        }

        $score = max(0, min(100, 100 + array_sum(array_column($factors, 'impact'))));

        return ['score' => $score, 'level' => $score >= 80 ? 'good' : ($score >= 60 ? 'fair' : 'poor'), 'factors' => $factors];
    }
}
