import { SheetSync, SheetSyncBody, SyncDestination, SyncFrequency } from '../../core/api/api.types';
import { FieldErrors } from '../../core/forms/server-errors';

/** Limites do backend (ADR 0027). */
export const SYNC_LIMITS = { minDays: 7, maxDays: 400, maxMetrics: 30 } as const;
export const SYNC_DAY_PRESETS: readonly number[] = [30, 90, 365];
/** Enquanto alguma exportação está rodando, a lista é atualizada a cada 5 s. */
export const SYNC_POLL_MS = 5_000;

export const FREQUENCY_TEXT: Readonly<Record<SyncFrequency, string>> = {
  daily: 'Diária',
  weekly: 'Semanal',
};

export interface SyncDraft {
  /** null = nova exportação. */
  id: string | null;
  project_id: string;
  connection_id: string;
  name: string;
  metrics: string[];
  /** Texto do campo (validado ao salvar). */
  days: string;
  frequency: SyncFrequency;
}

export function emptySyncDraft(destinations: readonly SyncDestination[], projectId = ''): SyncDraft {
  return {
    id: null,
    project_id: projectId,
    connection_id: destinations.length === 1 ? destinations[0].id : '',
    name: '',
    metrics: [],
    days: '30',
    frequency: 'daily',
  };
}

export function syncDraftFrom(sync: SheetSync): SyncDraft {
  return {
    id: sync.id,
    project_id: sync.project?.id ?? '',
    connection_id: sync.destination?.id ?? '',
    name: sync.name,
    metrics: [...sync.metrics],
    days: String(sync.days),
    frequency: sync.frequency,
  };
}

export function validateSyncDraft(d: SyncDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (d.id === null && !d.project_id) errors['project_id'] = 'Escolha o projeto.';
  if (d.id === null && !d.connection_id) errors['connection_id'] = 'Escolha o destino Google Sheets.';
  if (!d.name.trim()) errors['name'] = 'Dê um nome à exportação.';
  else if (d.name.trim().length > 120) errors['name'] = 'Use no máximo 120 caracteres.';
  if (d.metrics.length === 0) errors['metrics'] = 'Escolha ao menos uma métrica.';
  else if (d.metrics.length > SYNC_LIMITS.maxMetrics) errors['metrics'] = `Escolha no máximo ${SYNC_LIMITS.maxMetrics} métricas.`;
  const days = Number(d.days);
  if (!/^\d+$/.test(d.days.trim()) || days < SYNC_LIMITS.minDays || days > SYNC_LIMITS.maxDays) {
    errors['days'] = `Use de ${SYNC_LIMITS.minDays} a ${SYNC_LIMITS.maxDays} dias.`;
  }
  return errors;
}

/** Corpo do POST (com projeto e destino) ou do PATCH (sem eles). */
export function syncBody(d: SyncDraft): SheetSyncBody {
  const common = { name: d.name.trim(), metrics: d.metrics, days: Number(d.days), frequency: d.frequency };
  return d.id === null ? { project_id: d.project_id, connection_id: d.connection_id, ...common } : common;
}

export function scheduleText(s: Pick<SheetSync, 'frequency' | 'days'>): string {
  return `${FREQUENCY_TEXT[s.frequency]} · últimos ${s.days} dias`;
}

export type SyncTone = 'ok' | 'error' | 'running' | 'idle' | 'paused';

export function syncStatus(s: Pick<SheetSync, 'active' | 'last_status'>): { text: string; tone: SyncTone } {
  if (s.last_status === 'running') return { text: 'Rodando', tone: 'running' };
  if (!s.active) return { text: 'Pausada', tone: 'paused' };
  if (s.last_status === 'error') return { text: 'Erro', tone: 'error' };
  if (s.last_status === 'ok') return { text: 'OK', tone: 'ok' };
  return { text: 'Ainda não rodou', tone: 'idle' };
}

export function destinationModeText(mode: 'sandbox' | 'live'): string {
  return mode === 'sandbox' ? 'Demonstração' : 'Conta Google';
}

/** Célula da prévia: números no formato brasileiro, vazio como travessão. */
const NUMBER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export function previewCell(value: string | number | null): string {
  if (value === null || value === '') return '—';
  return typeof value === 'number' ? NUMBER.format(value) : value;
}
