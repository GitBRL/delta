<?php

declare(strict_types=1);

namespace App\Domain\Insights\Rules;

use App\Domain\Insights\Rule;
use App\Domain\Insights\RuleContext;
use App\Domain\Insights\Signal;
use App\Domain\Insights\SignalStatus;

/**
 * Faixa de boas práticas: o valor passou de um limite (acima ou abaixo).
 * Placeholders no texto: {value} e {threshold}, formatados pela unidade da métrica.
 */
final readonly class ThresholdRule implements Rule
{
    /** @param array<string, float> $minVolume métricas que precisam de volume mínimo para a regra valer (evita ruído) */
    public function __construct(
        private string $id,
        private string $metric,
        private bool $above,
        private float $attention,
        private ?float $critical,
        private string $title,
        private string $explanation,
        private string $suggestion,
        private string $window = RuleContext::PERIOD,
        private array $minVolume = [],
        private ?SignalStatus $statusOverride = null,
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
            if (($context->value($key, $this->window) ?? 0.0) < $minimum) {
                return null;
            }
        }

        $value = $context->value($this->metric, $this->window);
        if ($value === null) {
            return null;
        }

        $beyond = fn (float $limit): bool => $this->above ? $value > $limit : $value < $limit;

        if ($this->critical !== null && $beyond($this->critical)) {
            [$status, $threshold] = [SignalStatus::Critical, $this->critical];
        } elseif ($beyond($this->attention)) {
            [$status, $threshold] = [SignalStatus::Attention, $this->attention];
        } else {
            return null;
        }

        $replace = [
            '{value}' => $context->format($this->metric, $value),
            '{threshold}' => $context->format($this->metric, $threshold),
        ];

        return new Signal(
            rule: $this->id,
            metric: $this->metric,
            status: $this->statusOverride ?? $status,
            title: $this->title,
            explanation: strtr($this->explanation, $replace),
            suggestion: $this->suggestion,
            evidence: ['value' => $value, 'threshold' => $threshold, 'window' => $this->window],
        );
    }
}
