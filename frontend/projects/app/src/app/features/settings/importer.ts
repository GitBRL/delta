import { DataImport, ImportReconnectItem, ImportStatus } from '../../core/api/api.types';

/** Selo de cada estado da importação. */
export const IMPORT_STATUS: Readonly<Record<ImportStatus, { label: string; tone: 'ok' | 'warn' | 'off' | 'busy' }>> = {
  queued: { label: 'Na fila', tone: 'busy' },
  running: { label: 'Importando…', tone: 'busy' },
  done: { label: 'Concluída', tone: 'ok' },
  failed: { label: 'Falhou', tone: 'warn' },
};

export const IMPORT_POLL_MS = 2000;

export function importRunning(i: DataImport | null): boolean {
  return !!i && (i.status === 'queued' || i.status === 'running');
}

export interface ImportTotals {
  projectsCreated: number;
  projectsExisting: number;
  timelineEvents: number;
  reconnect: ImportReconnectItem[];
}

/** Resumo com zeros no lugar do que faltar (enquanto está na fila o backend manda `[]`). */
export function importTotals(i: DataImport): ImportTotals {
  const s = Array.isArray(i.summary) ? {} : i.summary;
  return {
    projectsCreated: s.projects_created ?? 0,
    projectsExisting: s.projects_existing ?? 0,
    timelineEvents: s.timeline_events ?? 0,
    reconnect: s.reconnect ?? [],
  };
}

/** Uma linha: "3 projetos criados · 1 já existia · 12 marcos". */
export function importSummaryLine(i: DataImport): string {
  if (i.status === 'failed') return i.error ?? 'A importação falhou.';
  if (importRunning(i)) return IMPORT_STATUS[i.status].label;
  const t = importTotals(i);
  const parts = [
    plural(t.projectsCreated, 'projeto criado', 'projetos criados'),
    plural(t.projectsExisting, 'já existia', 'já existiam'),
    plural(t.timelineEvents, 'marco', 'marcos'),
  ];
  if (t.reconnect.length) parts.push(plural(t.reconnect.length, 'conta para reconectar', 'contas para reconectar'));
  return parts.join(' · ');
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export interface ReconnectGroup {
  project: string;
  items: { key: string; platform: string; account: string }[];
}

/** Contas para reconectar agrupadas por projeto, na ordem em que vieram. A chave é estável por importação. */
export function groupReconnect(importId: string, items: readonly ImportReconnectItem[]): ReconnectGroup[] {
  const groups = new Map<string, ReconnectGroup>();
  items.forEach((item, index) => {
    const project = item.project || 'Sem projeto';
    const group = groups.get(project) ?? { project, items: [] };
    group.items.push({ key: `${importId}:${index}`, platform: item.platform || 'Integração', account: item.account });
    groups.set(project, group);
  });
  return [...groups.values()];
}

/** Erro do token antes de enviar (ou null). */
export function importTokenProblem(token: string): string | null {
  const value = token.trim();
  if (!value) return 'Cole o token da API do Reportei.';
  if (/\s/.test(value)) return 'O token não tem espaços. Copie de novo do Reportei.';
  if (value.length < 20) return 'O token parece incompleto. Copie de novo do Reportei.';
  return null;
}

/* ---------- Checklist (preferência só deste navegador) ---------- */

const CHECK_KEY = (importId: string) => `delta.import.${importId}.reconnected`;

export function readChecked(importId: string): string[] {
  try {
    const raw = localStorage.getItem(CHECK_KEY(importId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function writeChecked(importId: string, keys: readonly string[]): void {
  try {
    localStorage.setItem(CHECK_KEY(importId), JSON.stringify(keys));
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
}
