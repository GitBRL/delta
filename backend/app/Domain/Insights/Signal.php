<?php

declare(strict_types=1);

namespace App\Domain\Insights;

/** Um alerta do semáforo: o que está fora do esperado, por quê, e o que fazer. */
final readonly class Signal
{
    /** @param array<string, float|int|string|null> $evidence números que dispararam a regra */
    public function __construct(
        public string $rule,
        public string $metric,
        public SignalStatus $status,
        public string $title,
        public string $explanation,
        public string $suggestion,
        public array $evidence = [],
    ) {}

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'rule' => $this->rule,
            'metric' => $this->metric,
            'status' => $this->status->value,
            'title' => $this->title,
            'explanation' => $this->explanation,
            'suggestion' => $this->suggestion,
            'evidence' => $this->evidence,
        ];
    }
}
