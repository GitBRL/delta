<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog;

/** Definição de uma métrica do catálogo (fonte: classes em Catalog\Providers). */
final readonly class MetricSpec
{
    public function __construct(
        public string $key,
        public string $label,
        public string $description,
        public MetricUnit $unit,
        public MetricKind $kind,
        public MetricDirection $direction = MetricDirection::HigherIsBetter,
        public int $decimals = 0,
        public ?string $formula = null,
        public bool $featured = false,
        public bool $visible = true,
    ) {}

    public static function additive(string $key, string $label, string $description, MetricUnit $unit = MetricUnit::Count, MetricDirection $direction = MetricDirection::HigherIsBetter, int $decimals = 0, bool $featured = false, bool $visible = true): self
    {
        return new self($key, $label, $description, $unit, MetricKind::Additive, $direction, $decimals, null, $featured, $visible);
    }

    public static function snapshot(string $key, string $label, string $description, bool $featured = false): self
    {
        return new self($key, $label, $description, MetricUnit::Count, MetricKind::Snapshot, MetricDirection::HigherIsBetter, 0, null, $featured);
    }

    public static function nonAdditive(string $key, string $label, string $description, MetricUnit $unit = MetricUnit::Count, int $decimals = 0, bool $featured = false): self
    {
        return new self($key, $label, $description, $unit, MetricKind::NonAdditive, MetricDirection::HigherIsBetter, $decimals, null, $featured);
    }

    public static function derived(string $key, string $label, string $description, string $formula, MetricUnit $unit, MetricDirection $direction, int $decimals = 2, bool $featured = false): self
    {
        return new self($key, $label, $description, $unit, MetricKind::Derived, $direction, $decimals, $formula, $featured);
    }

    public function provider(): string
    {
        return explode(':', $this->key, 2)[0];
    }
}
