/**
 * Formatação de métricas em pt-BR, centralizada para KPIs, gráficos, tabelas e mensagens.
 *
 * Unidades (iguais ao catálogo de métricas da API):
 *  - currency  valor monetário (BRL por padrão)
 *  - percent   valor JÁ em 0–100 (ex.: 3.5 → "3,5%")
 *  - count     contagem; compacta a partir de 10 mil ("48,2 mil")
 *  - decimal   número com casas fixas (ex.: ROAS 4,10)
 *  - duration  segundos → "45 s", "2 min 05 s", "1 h 02 min"
 */
export type MetricUnit = 'count' | 'currency' | 'percent' | 'decimal' | 'duration';

export type MetricFormatter = (value: number) => string;

export interface MetricFormatOptions {
  currency?: string;
}

const LOCALE = 'pt-BR';
const EMPTY = '—';

/** A partir daqui, contagens viram notação compacta ("48,2 mil"). */
const COMPACT_COUNT_FROM = 10_000;
/** A partir daqui, valores monetários viram notação compacta ("R$ 1,2 mi"). */
const COMPACT_CURRENCY_FROM = 1_000_000;

export function formatMetric(
  value: number | null | undefined,
  unit: MetricUnit,
  decimals?: number,
  options: MetricFormatOptions = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EMPTY;
  }

  switch (unit) {
    case 'currency':
      return formatCurrency(value, decimals ?? 2, options.currency ?? 'BRL');
    case 'percent':
      return formatPercent(value, decimals ?? 1);
    case 'decimal':
      return formatDecimal(value, decimals ?? 2);
    case 'duration':
      return formatDuration(value);
    case 'count':
    default:
      return formatCount(value);
  }
}

/** Fábrica de formatador com referência estável (útil como input de componentes). */
export function metricFormatter(unit: MetricUnit, decimals?: number, options?: MetricFormatOptions): MetricFormatter {
  return (value: number) => formatMetric(value, unit, decimals, options);
}

export function formatCurrency(value: number, decimals = 2, currency = 'BRL'): string {
  if (Math.abs(value) >= COMPACT_CURRENCY_FROM) {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** @param value percentual em 0–100. */
export function formatPercent(value: number, decimals = 1): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value / 100);
}

export function formatCount(value: number): string {
  if (Math.abs(value) >= COMPACT_COUNT_FROM) {
    return new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(value);
}

export function formatDecimal(value: number, decimals = 2): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** @param totalSeconds duração em segundos. */
export function formatDuration(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : '';
  const seconds = Math.round(Math.abs(totalSeconds));

  if (seconds < 60) {
    return `${sign}${seconds} s`;
  }
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${sign}${m} min ${pad2(s)} s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${sign}${h} h ${pad2(m)} min`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}
