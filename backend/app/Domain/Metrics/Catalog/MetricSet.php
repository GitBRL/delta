<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog;

use App\Domain\Metrics\Formula\Formula;
use App\Domain\Metrics\Formula\FormulaException;
use App\Models\CustomMetric;
use App\Models\ManualMetric;

/**
 * Conjunto de métricas visível para uma agência: o catálogo global, os indicadores
 * personalizados (sempre "derivados": fórmula sobre os totais do período) e as métricas da
 * fonte manual ("manual:…", lançadas por projeto; ADR 0015).
 */
final class MetricSet
{
    /** @var array<string, Formula> */
    private array $formulas = [];

    /**
     * @param  array<string, MetricSpec>  $custom
     * @param  array<string, MetricSpec>  $manual
     */
    public function __construct(
        private readonly Catalog $catalog,
        private array $custom = [],
        private array $manual = [],
    ) {}

    /** Catálogo + indicadores da agência do contexto (o RLS limita à agência). */
    public static function forCurrentTenant(Catalog $catalog): self
    {
        $custom = [];
        foreach (CustomMetric::query()->get() as $metric) {
            $custom[$metric->key] = $metric->toSpec();
        }

        $manual = [];
        foreach (ManualMetric::query()->get() as $metric) {
            $manual[$metric->key] = $metric->toSpec();
        }

        return new self($catalog, $custom, $manual);
    }

    /** Cópia com um indicador a mais (ou substituído): usada para validar e pré-visualizar. */
    public function with(MetricSpec $metric): self
    {
        return new self($this->catalog, [...$this->custom, $metric->key => $metric], $this->manual);
    }

    public function metric(string $key): ?MetricSpec
    {
        return $this->catalog->metric($key) ?? $this->custom[$key] ?? $this->manual[$key] ?? null;
    }

    public function has(string $key): bool
    {
        return $this->metric($key) !== null;
    }

    /** @return list<string> */
    public function keys(): array
    {
        return [...array_keys($this->catalog->metrics()), ...array_keys($this->custom), ...array_keys($this->manual)];
    }

    /** @return array<string, MetricSpec> */
    public function custom(): array
    {
        return $this->custom;
    }

    public function formula(MetricSpec $metric): Formula
    {
        if ($this->catalog->metric($metric->key) !== null) {
            return $this->catalog->formula($metric);
        }

        if ($metric->formula === null) {
            throw new FormulaException("A métrica {$metric->key} não tem fórmula.");
        }

        return $this->formulas[$metric->key] ??= Formula::parse($metric->formula);
    }

    /**
     * Métricas armazenadas (não derivadas) necessárias para calcular $keys. Detecta ciclos.
     *
     * @param  list<string>  $keys
     * @return list<string>
     */
    public function baseMetricsFor(array $keys): array
    {
        $base = [];
        foreach ($keys as $key) {
            $this->collectBase($key, [], $base);
        }

        return array_keys($base);
    }

    /**
     * Plataformas de que um indicador depende (para saber em quais projetos ele faz sentido).
     *
     * @return list<string>
     */
    public function providersFor(string $key): array
    {
        $providers = array_map(fn (string $base): string => explode(':', $base, 2)[0], $this->baseMetricsFor([$key]));

        return array_values(array_unique($providers));
    }

    /**
     * @param  list<string>  $path  cadeia atual de derivadas (para detectar ciclos)
     * @param  array<string, true>  $base
     */
    private function collectBase(string $key, array $path, array &$base): void
    {
        if (in_array($key, $path, true)) {
            throw new FormulaException('Ciclo entre indicadores: '.implode(' → ', [...$path, $key]).'.');
        }

        $metric = $this->metric($key) ?? throw new FormulaException("Métrica ou indicador desconhecido: {$key}.");

        if ($metric->kind !== MetricKind::Derived) {
            $base[$key] = true;

            return;
        }

        foreach ($this->formula($metric)->references() as $ref) {
            $this->collectBase($ref, [...$path, $key], $base);
        }
    }
}
