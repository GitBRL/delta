import { HttpErrorResponse } from '@angular/common/http';
import { AdChange, AdLevel } from '../../core/api/api.types';

/** Status efetivos da Meta em pt-BR. */
const STATUS_TEXT: Readonly<Record<string, string>> = {
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  CAMPAIGN_PAUSED: 'Campanha pausada',
  ADSET_PAUSED: 'Conjunto pausado',
  IN_PROCESS: 'Em processamento',
  WITH_ISSUES: 'Com problemas',
  PENDING_REVIEW: 'Em revisão',
  DISAPPROVED: 'Reprovada',
  PREAPPROVED: 'Pré-aprovada',
  PENDING_BILLING_INFO: 'Pagamento pendente',
  ARCHIVED: 'Arquivada',
  DELETED: 'Excluída',
};

export function statusText(status: string): string {
  return STATUS_TEXT[status] ?? status.toLowerCase().replace(/_/g, ' ');
}

export type StatusTone = 'active' | 'paused' | 'issue' | 'other';

export function statusTone(status: string): StatusTone {
  if (status === 'ACTIVE') return 'active';
  if (status.endsWith('PAUSED')) return 'paused';
  if (['WITH_ISSUES', 'DISAPPROVED', 'PENDING_BILLING_INFO'].includes(status)) return 'issue';
  return 'other';
}

/** Pausar só o que está ativo; ativar só o que foi pausado no próprio objeto. */
export function canPause(status: string): boolean {
  return status === 'ACTIVE';
}

export function canActivate(status: string): boolean {
  return status === 'PAUSED';
}

const OBJECTIVES: Readonly<Record<string, string>> = {
  OUTCOME_SALES: 'Vendas',
  OUTCOME_LEADS: 'Cadastros',
  OUTCOME_TRAFFIC: 'Tráfego',
  OUTCOME_AWARENESS: 'Reconhecimento',
  OUTCOME_ENGAGEMENT: 'Engajamento',
  OUTCOME_APP_PROMOTION: 'Promoção de app',
};

export function objectiveText(objective: string | null): string {
  if (!objective) return '—';
  return OBJECTIVES[objective] ?? objective.replace(/^OUTCOME_/, '').toLowerCase().replace(/_/g, ' ');
}

const money = new Map<string, Intl.NumberFormat>();

export function moneyText(value: number | null, currency = 'BRL'): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const code = /^[A-Z]{3}$/.test(currency) ? currency : 'BRL';
  let f = money.get(code);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code });
    money.set(code, f);
  }
  return f.format(value);
}

/** Custo por resultado nos 7 dias (null sem resultados). */
export function costPerResult(spend: number, results: number): number | null {
  return results > 0 ? spend / results : null;
}

const PCT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** Variação do orçamento em % (positiva = aumento). */
export function changePct(current: number, next: number): number | null {
  if (!(current > 0) || !Number.isFinite(next)) return null;
  return ((next - current) / current) * 100;
}

export function changePctText(pct: number | null): string {
  if (pct === null) return '—';
  return `${pct > 0 ? '+' : ''}${PCT.format(pct)}%`;
}

/** "150,5" → 150.5; aceita vírgula ou ponto decimal. null se inválido. */
export function parseMoney(text: string): number | null {
  const clean = text.trim().replace(/\s|R\$/g, '');
  if (!clean) return null;
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Chave de idempotência por ação (8 a 80 caracteres). */
export function idempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `delta-${uuid ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 12)}`;
}

/** O 422 de orçamento pede confirmação ("Mudança de N%")? Devolve a mensagem nesse caso. */
export function largeChangeMessage(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 422) return null;
  const messages = (error.error as { errors?: Record<string, string[]> } | null)?.errors?.['daily_budget'];
  const first = Array.isArray(messages) ? String(messages[0] ?? '') : '';
  return /Mudança de \d+%/.test(first) ? first : null;
}

/** Primeira mensagem de erro do 422 entre os campos da mudança. */
export function changeError(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 422) return null;
  const errors = (error.error as { errors?: Record<string, string[]>; message?: string } | null) ?? null;
  for (const field of ['change', 'action', 'daily_budget', 'object_id', 'idempotency_key', 'account']) {
    const m = errors?.errors?.[field];
    if (Array.isArray(m) && m.length > 0) return String(m[0]);
  }
  return errors?.message ?? null;
}

export function levelText(level: AdLevel): string {
  return level === 'campaign' ? 'Campanha' : 'Conjunto';
}

/** Linha do histórico: "Pausou", "Ativou" ou "Orçamento R$ 150,00 → R$ 195,00". */
export function changeSummary(c: AdChange, currency = 'BRL'): string {
  if (c.action === 'pause') return 'Pausou';
  if (c.action === 'activate') return 'Ativou';
  return `Orçamento diário ${moneyText(c.before.daily_budget ?? null, currency)} → ${moneyText(c.after.daily_budget ?? null, currency)}`;
}
