import { ManualAggregation, ManualMetricBody, MetricDirection, MetricUnit } from '../../core/api/api.types';

export const UNIT_OPTIONS: readonly { value: MetricUnit; label: string }[] = [
  { value: 'count', label: 'Contagem (vendas, leads, pedidos)' },
  { value: 'currency', label: 'Dinheiro (R$)' },
  { value: 'percent', label: 'Percentual (%)' },
  { value: 'decimal', label: 'Número com casas (nota, índice)' },
  { value: 'duration', label: 'Duração (segundos)' },
];

export const DIRECTION_OPTIONS: readonly { value: MetricDirection; label: string }[] = [
  { value: 'higher_is_better', label: 'Quanto maior, melhor' },
  { value: 'lower_is_better', label: 'Quanto menor, melhor' },
  { value: 'neutral', label: 'Neutro' },
];

export const AGGREGATION_OPTIONS: readonly { value: ManualAggregation; label: string; help: string }[] = [
  {
    value: 'sum',
    label: 'Somar os dias',
    help: 'Para o que acontece a cada dia: vendas, leads, pedidos, receita. O período soma os dias lançados.',
  },
  {
    value: 'last',
    label: 'Último valor',
    help: 'Para uma situação no momento: clientes ativos, estoque, nota. O período usa o último valor lançado.',
  },
];

export const EMPTY_MANUAL: ManualMetricBody = {
  name: '',
  description: null,
  unit: 'count',
  direction: 'higher_is_better',
  decimals: 0,
  aggregation: 'sum',
};

/** Dias do mês "YYYY-MM" em YYYY-MM-DD. */
export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return [];
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** "2026-11" → "novembro de 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
}

/** Mês corrente em "YYYY-MM". */
export function currentMonth(today: Date = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

/** Converte o que a pessoa digitou ("1.234,56", "R$ 10", "12.5") em número; vazio = null; inválido = NaN. */
export function parseCell(text: string): number | null {
  const raw = text.trim();
  if (raw === '') return null;
  const clean = raw.replace(/[^\d,.-]/g, '');
  if (!clean || clean === '-') return Number.NaN;
  const normalized =
    clean.includes(',') && (!clean.includes('.') || clean.lastIndexOf(',') > clean.lastIndexOf('.'))
      ? clean.replace(/\./g, '').replace(',', '.')
      : clean.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Valor como aparece na célula (pt-BR, sem separador de milhar). */
export function cellText(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined) return '';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: Math.max(decimals, 2), useGrouping: false }).format(value);
}

/** Total do mês conforme a agregação ("sum": soma; "last": último dia com valor). */
export function monthTotal(values: ReadonlyMap<string, number>, days: readonly string[], aggregation: ManualAggregation): number | null {
  const present = days.filter((d) => values.has(d));
  if (present.length === 0) return null;
  if (aggregation === 'last') return values.get(present[present.length - 1]) ?? null;
  return present.reduce((sum, d) => sum + (values.get(d) ?? 0), 0);
}

/** Entradas que mudaram em relação ao salvo (valor null = apagar o dia). */
export function changedEntries(
  saved: ReadonlyMap<string, number>,
  edited: ReadonlyMap<string, number | null>,
): { date: string; value: number | null }[] {
  const out: { date: string; value: number | null }[] = [];
  for (const [date, value] of edited) {
    const before = saved.has(date) ? saved.get(date)! : null;
    if (value !== before) out.push({ date, value });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
