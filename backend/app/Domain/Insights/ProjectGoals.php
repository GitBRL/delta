<?php

declare(strict_types=1);

namespace App\Domain\Insights;

use App\Models\Project;

/**
 * Perfil de negócio do projeto que calibra o semáforo (§7.2 do plano): com a margem bruta,
 * o ROAS de equilíbrio é 100 ÷ margem; com a meta de CPA, o alerta usa a meta do cliente
 * em vez de só a variação contra o período anterior.
 */
final readonly class ProjectGoals
{
    public function __construct(
        public ?float $grossMarginPct = null,
        public ?float $targetCpa = null,
        public ?float $targetRoas = null,
    ) {}

    public static function of(Project $project): self
    {
        $settings = is_array($project->settings) ? $project->settings : [];
        $number = fn (string $key): ?float => isset($settings[$key]) && is_numeric($settings[$key]) && (float) $settings[$key] > 0
            ? (float) $settings[$key]
            : null;

        return new self($number('gross_margin_pct'), $number('target_cpa'), $number('target_roas'));
    }

    /** ROAS mínimo para não ter prejuízo (sem margem informada: 1, só recupera o investido). */
    public function breakEvenRoas(): float
    {
        return $this->grossMarginPct === null ? 1.0 : 100 / $this->grossMarginPct;
    }
}
