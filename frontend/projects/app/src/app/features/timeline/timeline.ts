import { DsIconName } from 'design-system';
import { TimelineEvent, TimelineEventType } from '../../core/api/api.types';

export interface TimelineTypeMeta {
  label: string;
  icon: DsIconName;
  /** Variável CSS da cor do ícone. */
  color: string;
}

export const TIMELINE_TYPES: Readonly<Record<TimelineEventType, TimelineTypeMeta>> = {
  manual: { label: 'Marco', icon: 'flag', color: '--ds-accent' },
  report_published: { label: 'Relatório publicado', icon: 'file-text', color: '--ds-status-opportunity' },
  automation_sent: { label: 'Relatório enviado', icon: 'send', color: '--ds-status-opportunity' },
  goal_achieved: { label: 'Meta batida', icon: 'target', color: '--ds-status-healthy' },
  goal_off_track: { label: 'Meta fora do ritmo', icon: 'target', color: '--ds-status-critical' },
  goal_at_risk: { label: 'Meta em risco', icon: 'target', color: '--ds-status-attention' },
  action_applied: { label: 'Ação aplicada', icon: 'list-checks', color: '--ds-accent' },
  action_result: { label: 'Resultado de ação', icon: 'list-checks', color: '--ds-status-healthy' },
  ads_change: { label: 'Anúncios', icon: 'megaphone', color: '--ds-status-opportunity' },
};

export function timelineMeta(type: TimelineEventType | string): TimelineTypeMeta {
  return TIMELINE_TYPES[type as TimelineEventType] ?? TIMELINE_TYPES.manual;
}

const LONG = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

/** "10 de nov. de 2026" a partir de YYYY-MM-DD (data local, sem fuso). */
export function eventDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? LONG.format(new Date(y, m - 1, d)) : iso;
}

/** "hoje", "ontem", "há 3 dias", "há 2 semanas"… por dias de calendário. */
export function daysAgo(iso: string, today: Date = new Date()): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  const day = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((now - day) / 86_400_000);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'ontem';
  if (diff === -1) return 'amanhã';
  if (diff < 0) return `em ${-diff} dias`;
  if (diff < 14) return `há ${diff} dias`;
  if (diff < 60) return `há ${Math.round(diff / 7)} semanas`;
  return `há ${Math.round(diff / 30)} meses`;
}

/** Marcos do período para o gráfico (só os dias dentro do intervalo). */
export function chartMarkers(events: readonly TimelineEvent[], start: string, end: string): { date: string; label: string }[] {
  return events
    .filter((e) => e.occurred_on >= start && e.occurred_on <= end)
    .map((e) => ({ date: e.occurred_on, label: e.title }));
}
