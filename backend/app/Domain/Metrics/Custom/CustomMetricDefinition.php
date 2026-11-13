<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Custom;

use App\Domain\Metrics\Catalog\MetricDirection;
use App\Domain\Metrics\Catalog\MetricKind;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Catalog\MetricSpec;
use App\Domain\Metrics\Catalog\MetricUnit;
use App\Domain\Metrics\Formula\Formula;
use App\Domain\Metrics\Formula\FormulaException;
use App\Models\CustomMetric;
use Illuminate\Support\Str;

/**
 * Regras de um indicador personalizado: chave a partir do nome, fórmula válida, referências
 * existentes e nenhum ciclo entre indicadores (considerando todos os da agência).
 */
final class CustomMetricDefinition
{
    public const MAX_REFERENCES = 20;

    /**
     * Valida e devolve a especificação. Lança FormulaException com mensagem pronta para o usuário.
     *
     * @return array{spec: MetricSpec, references: list<string>}
     */
    public static function build(MetricSet $set, string $key, string $name, ?string $description, string $formula, MetricUnit $unit, MetricDirection $direction, int $decimals): array
    {
        $parsed = Formula::parse($formula);
        $references = $parsed->references();

        if ($references === []) {
            throw new FormulaException('A fórmula precisa usar ao menos uma métrica ou indicador.');
        }

        if (count($references) > self::MAX_REFERENCES) {
            throw new FormulaException('Use no máximo '.self::MAX_REFERENCES.' métricas diferentes em uma fórmula.');
        }

        $unknown = array_values(array_filter($references, fn (string $ref): bool => $ref !== $key && ! $set->has($ref)));
        if ($unknown !== []) {
            throw new FormulaException('Métrica ou indicador desconhecido: '.implode(', ', $unknown).'.');
        }

        $spec = new MetricSpec($key, $name, $description ?? '', $unit, MetricKind::Derived, $direction, $decimals, $formula);

        // Ciclos: confere o indicador novo e todos os existentes com ele já incluído/alterado.
        $candidate = $set->with($spec);
        $candidate->baseMetricsFor([$key, ...array_keys($set->custom())]);

        return ['spec' => $spec, 'references' => $references];
    }

    /** custom:slug a partir do nome (ex.: "ROAS combinado" → custom:roas_combinado). */
    public static function keyFor(string $name): string
    {
        $slug = Str::limit(Str::slug(Str::ascii($name), '_'), 60, '');

        if ($slug === '' || preg_match('/^[a-z]/', $slug) !== 1) {
            $slug = 'i_'.$slug;
        }

        return CustomMetric::PREFIX.rtrim($slug, '_');
    }
}
