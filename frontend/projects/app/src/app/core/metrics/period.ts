import { CompareMode, DateRange } from '../api/api.types';

/**
 * Períodos de análise. Os dados das plataformas (e os de demonstração) vão até ONTEM:
 * nenhum período termina depois disso. Todas as datas são locais (sem fuso), em YYYY-MM-DD.
 */

export type PeriodPreset = 'last_7' | 'last_14' | 'last_30' | 'last_month' | 'this_month' | 'custom';

export const PERIOD_PRESETS: readonly { value: PeriodPreset; label: string }[] = [
  { value: 'last_7', label: 'Últimos 7 dias' },
  { value: 'last_14', label: 'Últimos 14 dias' },
  { value: 'last_30', label: 'Últimos 30 dias' },
  { value: 'last_month', label: 'Mês passado' },
  { value: 'this_month', label: 'Este mês' },
  { value: 'custom', label: 'Personalizado' },
];

export const COMPARE_OPTIONS: readonly { value: CompareMode; label: string; caption: string }[] = [
  { value: 'previous_period', label: 'Período anterior', caption: 'vs período anterior' },
  { value: 'previous_year', label: 'Ano anterior', caption: 'vs ano anterior' },
  { value: 'none', label: 'Sem comparação', caption: '' },
];

/** Limite do backend para o tamanho do intervalo. */
export const MAX_RANGE_DAYS = 400;

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  // rejeita datas que "transbordam" (ex.: 2026-02-31)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Último dia com dados: ontem em relação a `today`. */
export function lastAvailableDay(today: Date = new Date()): Date {
  return addDays(today, -1);
}

/** Quantidade de dias do intervalo, contando as duas pontas. */
export function rangeDays(range: DateRange): number {
  const start = parseIsoDate(range.start);
  const end = parseIsoDate(range.end);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/**
 * Intervalo de um preset. `null` quando o preset ainda não tem nenhum dia com dados
 * (ex.: "Este mês" no dia 1) ou quando é "custom".
 */
export function resolvePreset(preset: PeriodPreset, today: Date = new Date()): DateRange | null {
  const end = lastAvailableDay(today);

  switch (preset) {
    case 'last_7':
    case 'last_14':
    case 'last_30': {
      const days = Number(preset.split('_')[1]);
      return { start: toIsoDate(addDays(end, -(days - 1))), end: toIsoDate(end) };
    }
    case 'last_month': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: toIsoDate(start), end: toIsoDate(last) };
    }
    case 'this_month': {
      if (today.getDate() === 1) return null;
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: toIsoDate(start), end: toIsoDate(end) };
    }
    case 'custom':
    default:
      return null;
  }
}

/** Mensagem de erro do intervalo (mesmas regras do backend) ou null se válido. */
export function validateRange(range: DateRange, today: Date = new Date()): string | null {
  const start = parseIsoDate(range.start);
  const end = parseIsoDate(range.end);
  if (!start || !end) return 'Informe as duas datas.';
  if (end < start) return 'A data final precisa ser igual ou posterior à inicial.';
  if (end > lastAvailableDay(today)) return 'Os dados vão até ontem; escolha uma data final anterior.';
  if (rangeDays(range) > MAX_RANGE_DAYS) return `O período pode ter no máximo ${MAX_RANGE_DAYS} dias.`;
  return null;
}

export function compareCaption(mode: CompareMode): string {
  return COMPARE_OPTIONS.find((o) => o.value === mode)?.caption ?? '';
}

/** "05/11/2026 – 11/11/2026" */
export function formatRange(range: DateRange): string {
  const fmt = (iso: string) => iso.split('-').reverse().join('/');
  return range.start === range.end ? fmt(range.start) : `${fmt(range.start)} – ${fmt(range.end)}`;
}
