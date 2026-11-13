import {
  CompareMode,
  CustomMetric,
  CustomMetricBody,
  CustomMetricPreviewBody,
  DateRange,
  ManualMetric,
  MetricDefinition,
  MetricDirection,
  MetricUnit,
  Provider,
} from '../api/api.types';
import { FORMULA_FUNCTIONS, FormulaOption } from './formula';

export const UNIT_OPTIONS: readonly { value: MetricUnit; label: string }[] = [
  { value: 'count', label: 'Número' },
  { value: 'currency', label: 'Moeda (R$)' },
  { value: 'percent', label: 'Percentual (%)' },
  { value: 'decimal', label: 'Decimal (ex.: ROAS 3,2)' },
  { value: 'duration', label: 'Duração (segundos)' },
];

export const DIRECTION_OPTIONS: readonly { value: MetricDirection; label: string }[] = [
  { value: 'higher_is_better', label: 'Maior é melhor' },
  { value: 'lower_is_better', label: 'Menor é melhor' },
  { value: 'neutral', label: 'Neutro' },
];

export function unitLabel(unit: MetricUnit): string {
  return UNIT_OPTIONS.find((u) => u.value === unit)?.label ?? unit;
}

export function directionLabel(direction: MetricDirection): string {
  return DIRECTION_OPTIONS.find((d) => d.value === direction)?.label ?? direction;
}

/** Estado editável do formulário de indicador. */
export interface CustomMetricDraft {
  name: string;
  description: string;
  formula: string;
  unit: MetricUnit;
  direction: MetricDirection;
  decimals: number;
}

export const EMPTY_DRAFT: CustomMetricDraft = {
  name: '',
  description: '',
  formula: '',
  unit: 'decimal',
  direction: 'higher_is_better',
  decimals: 2,
};

function clampDecimals(value: number): number {
  return Number.isFinite(value) ? Math.min(6, Math.max(0, Math.round(value))) : 2;
}

/** Corpo de POST/PUT /api/custom-metrics. Descrição vazia vira null. */
export function buildCustomMetricBody(draft: CustomMetricDraft): CustomMetricBody {
  const description = draft.description.trim();
  return {
    name: draft.name.trim(),
    description: description || null,
    formula: draft.formula.trim(),
    unit: draft.unit,
    direction: draft.direction,
    decimals: clampDecimals(draft.decimals),
  };
}

export function draftFrom(source: Pick<CustomMetric, 'name' | 'description' | 'formula' | 'unit' | 'direction' | 'decimals'>): CustomMetricDraft {
  return {
    name: source.name,
    description: source.description ?? '',
    formula: source.formula,
    unit: source.unit,
    direction: source.direction,
    decimals: source.decimals,
  };
}

/** Corpo do preview ao vivo (POST /api/custom-metrics/preview). */
export function buildPreviewBody(
  draft: CustomMetricDraft,
  projectId: string,
  range: DateRange,
  compare: CompareMode,
): CustomMetricPreviewBody {
  return {
    formula: draft.formula.trim(),
    unit: draft.unit,
    direction: draft.direction,
    decimals: clampDecimals(draft.decimals),
    project_id: projectId,
    start: range.start,
    end: range.end,
    compare,
  };
}

/**
 * Indicadores que fazem sentido para um projeto: os que usam alguma plataforma vinculada,
 * ou que não dependem de plataforma nenhuma.
 */
export function relevantCustomMetrics(metrics: readonly CustomMetric[], linkedProviders: Iterable<string>): CustomMetric[] {
  const linked = new Set(linkedProviders);
  return metrics.filter((m) => m.providers.length === 0 || m.providers.some((p) => linked.has(p)));
}

/** Opções do autocompletar: catálogo agrupado por plataforma + indicadores + funções. */
export function formulaOptions(
  catalog: readonly MetricDefinition[],
  providers: readonly Provider[],
  customs: readonly CustomMetric[],
  excludeKey?: string,
  manuals: readonly ManualMetric[] = [],
): FormulaOption[] {
  const providerName = new Map(providers.map((p) => [p.key, p.name]));
  const metrics: FormulaOption[] = catalog.map((m) => ({
    key: m.key,
    label: m.label,
    group: providerName.get(m.provider) ?? m.provider,
    kind: 'metric',
    detail: m.description,
  }));
  const custom: FormulaOption[] = customs
    .filter((c) => c.key !== excludeKey)
    .map((c) => ({ key: c.key, label: c.name, group: 'Indicadores', kind: 'custom', detail: c.description ?? undefined }));
  const functions: FormulaOption[] = FORMULA_FUNCTIONS.map((f) => ({
    key: f.name,
    label: f.signature,
    group: 'Funções',
    kind: 'function',
    detail: f.description,
  }));
  const manual: FormulaOption[] = manuals.map((m) => ({
    key: m.key,
    label: m.name,
    group: 'Dados manuais',
    kind: 'metric',
    detail: m.description ?? undefined,
  }));
  return [...metrics, ...custom, ...manual, ...functions];
}

/** Rótulos legíveis das referências (para chips). */
export function referenceLabels(
  catalog: readonly MetricDefinition[],
  customs: readonly CustomMetric[],
  manuals: readonly ManualMetric[] = [],
): Map<string, string> {
  return new Map([
    ...catalog.map((m) => [m.key, m.label] as const),
    ...customs.map((c) => [c.key, c.name] as const),
    ...manuals.map((m) => [m.key, m.name] as const),
  ]);
}
