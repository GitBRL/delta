const RTF = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "agora", "há 5 minutos", "ontem"… a partir de um instante ISO. */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'nunca';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '—';

  const seconds = Math.round((time - now.getTime()) / 1000);
  if (Math.abs(seconds) < 45) return 'agora';

  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return RTF.format(Math.round(seconds / size), unit);
    }
  }
  return RTF.format(Math.round(seconds / 60), 'minute');
}
