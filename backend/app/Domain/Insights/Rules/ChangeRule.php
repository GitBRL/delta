<?php

declare(strict_types=1);

namespace App\Domain\Insights\Rules;

use App\Domain\Insights\Rule;
use App\Domain\Insights\RuleContext;
use App\Domain\Insights\Signal;
use App\Domain\Insights\SignalStatus;

/**
 * Desvio do próprio histórico: a métrica piorou mais que X% contra o período anterior.
 * "Piorar" é subir ($worseWhenUp) ou cair. Placeholders: {value}, {previous}, {change}.
 */
final readonly class ChangeRule implements Rule
{
    /** @param array<string, float> $minVolume */
    public function __construct(
        private string $id,
        private string $metric,
        private bool $worseWhenUp,
        private float $attentionPct,
        private ?float $criticalPct,
        private string $title,
        private string $explanation,
        private string $suggestion,
        private array $minVolume = [],
    ) {}

    public function id(): string
    {
        return $this->id;
    }

    public function provider(): string
    {
        return explode(':', $this->metric, 2)[0];
    }

    public function metrics(): array
    {
        return array_values(array_unique([$this->metric, ...array_keys($this->minVolume)]));
    }

    public function evaluate(RuleContext $context): ?Signal
    {
        foreach ($this->minVolume as $key => $minimum) {
            if (($context->value($key) ?? 0.0) < $minimum || ($context->previous($key) ?? 0.0) < $minimum) {
                return null;
            }
        }

        $change = $context->change($this->metric);
        if ($change === null) {
            return null;
        }

        $worsening = $this->worseWhenUp ? $change : -$change;

        $status = match (true) {
            $this->criticalPct !== null && $worsening >= $this->criticalPct => SignalStatus::Critical,
            $worsening >= $this->attentionPct => SignalStatus::Attention,
            default => null,
        };

        if ($status === null) {
            return null;
        }

        $value = $context->value($this->metric);
        $previous = $context->previous($this->metric);

        return new Signal(
            rule: $this->id,
            metric: $this->metric,
            status: $status,
            title: $this->title,
            explanation: strtr($this->explanation, [
                '{value}' => $context->format($this->metric, $value),
                '{previous}' => $context->format($this->metric, $previous),
                '{change}' => RuleContext::formatChange($change),
            ]),
            suggestion: $this->suggestion,
            evidence: ['value' => $value, 'previous' => $previous, 'change_pct' => $change],
        );
    }
}
