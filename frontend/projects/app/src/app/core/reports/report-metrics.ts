import { CustomMetric, ManualMetric, MetricDefinition, Provider } from '../api/api.types';

export interface MetricOption {
  key: string;
  label: string;
  /** Canal ("Meta Ads") ou "Indicadores personalizados". */
  group: string;
  description: string;
  /** O projeto tem conta deste canal? (indicadores personalizados: sempre true) */
  linked: boolean;
}

export const CUSTOM_GROUP = 'Indicadores personalizados';
export const MANUAL_GROUP = 'Dados manuais';

/**
 * Métricas que o relatório pode usar: catálogo + indicadores personalizados + dados manuais da
 * agência. Canais com conta no projeto vêm primeiro (na ordem dos providers); depois os demais.
 */
export function metricOptions(
  catalog: readonly MetricDefinition[],
  providers: readonly Provider[],
  customs: readonly CustomMetric[],
  linkedProviders: readonly string[],
  manuals: readonly ManualMetric[] = [],
): MetricOption[] {
  const order = new Map(providers.map((p, i) => [p.key, i]));
  const names = new Map(providers.map((p) => [p.key, p.name]));
  const linked = new Set(linkedProviders);
  const rank = (provider: string) => (linked.has(provider) ? 0 : 1000) + (order.get(provider) ?? 500);

  const fromCatalog = [...catalog]
    .sort((a, b) => rank(a.provider) - rank(b.provider))
    .map((m) => ({
      key: m.key,
      label: m.label,
      group: names.get(m.provider) ?? m.provider,
      description: m.description,
      linked: linked.has(m.provider),
    }));

  const fromCustoms = customs.map((c) => ({
    key: c.key,
    label: c.name,
    group: CUSTOM_GROUP,
    description: c.description ?? c.formula,
    linked: true,
  }));

  const fromManuals = manuals.map((m) => ({
    key: m.key,
    label: m.name,
    group: MANUAL_GROUP,
    description: m.description ?? (m.aggregation === 'sum' ? 'Lançado por dia; soma os dias do período.' : 'Lançado por dia; usa o último valor do período.'),
    linked: true,
  }));

  return [...fromCatalog, ...fromCustoms, ...fromManuals];
}

export interface OptionGroup {
  name: string;
  linked: boolean;
  options: MetricOption[];
}

/** Agrupa mantendo a ordem de chegada; filtra pelo texto (rótulo, chave ou canal, sem acento). */
export function groupOptions(options: readonly MetricOption[], query = ''): OptionGroup[] {
  const needle = normalize(query);
  const groups = new Map<string, OptionGroup>();
  for (const option of options) {
    if (needle && !normalize(`${option.label} ${option.key} ${option.group}`).includes(needle)) continue;
    let group = groups.get(option.group);
    if (!group) {
      group = { name: option.group, linked: option.linked, options: [] };
      groups.set(option.group, group);
    }
    group.options.push(option);
  }
  return [...groups.values()];
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
