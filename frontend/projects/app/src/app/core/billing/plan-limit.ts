import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { BillingLimitKey, PlanLimitErrorBody } from '../api/api.types';

export interface PlanLimitNotice {
  message: string;
  /** Limite ou recurso que barrou (ex.: "projects", "studio", "plan"). */
  limit: string | null;
  allowed: number | null;
  used: number | null;
}

const FALLBACK = 'Esta ação passa do que o plano da agência permite.';

/** É um 402 de limite do plano (ADR 0031)? */
export function isPlanLimitError(error: unknown): error is HttpErrorResponse {
  return error instanceof HttpErrorResponse && error.status === 402;
}

/** Aviso legível de um 402, ou null se não for limite do plano. */
export function planLimitNotice(error: unknown): PlanLimitNotice | null {
  if (!isPlanLimitError(error)) return null;
  const body = (error.error ?? null) as Partial<PlanLimitErrorBody> | null;
  const message = body?.message?.trim() || body?.errors?.plan?.[0]?.trim() || FALLBACK;
  return {
    message,
    limit: body?.plan_limit?.limit ?? null,
    allowed: body?.plan_limit?.allowed ?? null,
    used: body?.plan_limit?.used ?? null,
  };
}

/**
 * Último aviso de limite do plano. O interceptor preenche em qualquer 402; o shell mostra o
 * diálogo "Limite do plano" (com "Ver plano" para dono e administrador).
 */
@Injectable({ providedIn: 'root' })
export class PlanLimitService {
  readonly notice = signal<PlanLimitNotice | null>(null);

  show(notice: PlanLimitNotice): void {
    this.notice.set(notice);
  }

  dismiss(): void {
    this.notice.set(null);
  }
}

/* ---------- Plano e uso (página /configuracoes/plano e banner do teste) ---------- */

export const LIMIT_LABELS: Readonly<Record<BillingLimitKey, string>> = {
  projects: 'Projetos',
  seats: 'Pessoas na equipe',
  live_connections: 'Conexões reais',
  automations: 'Envios automáticos',
  whatsapp_messages: 'Mensagens de WhatsApp',
  ai_tokens: 'Tokens de IA',
};

/** Franquias que zeram todo mês. */
export const MONTHLY_LIMITS: ReadonlySet<BillingLimitKey> = new Set(['whatsapp_messages', 'ai_tokens']);

export const LIMIT_ORDER: readonly BillingLimitKey[] = ['projects', 'seats', 'live_connections', 'automations', 'whatsapp_messages', 'ai_tokens'];

const INT = new Intl.NumberFormat('pt-BR');
const COMPACT = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** "1.200", "3 mi" (tokens) ou "Sem limite". */
export function limitText(key: BillingLimitKey, value: number | null): string {
  if (value === null) return 'Sem limite';
  return key === 'ai_tokens' ? COMPACT.format(value) : INT.format(value);
}

export function usageText(key: BillingLimitKey, used: number): string {
  return key === 'ai_tokens' ? COMPACT.format(used) : INT.format(used);
}

/** Uso em % (0–100) para a barra; null quando não há limite. */
export function usagePct(used: number, limit: number | null): number | null {
  if (limit === null) return null;
  if (limit <= 0) return 100;
  return Math.min(100, Math.round((used / limit) * 100));
}

export type UsageTone = 'ok' | 'warn' | 'full';

export function usageTone(pct: number | null): UsageTone {
  if (pct === null || pct < 80) return 'ok';
  return pct >= 100 ? 'full' : 'warn';
}

/** Preço mensal ou "Sob consulta". */
export function priceText(price: number | null): string {
  return price === null ? 'Sob consulta' : `${BRL.format(price)}/mês`;
}

/** Dias inteiros até a data (arredonda para cima; negativo = passou). */
export function daysUntil(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const end = new Date(iso);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}

export type TrialBanner = { kind: 'ending'; days: number } | { kind: 'ended'; status: 'trialing' | 'canceled' } | null;

/** Banner discreto do shell: teste acabando (≤ 3 dias) ou plano inutilizável. */
export function trialBanner(b: { status: string; usable: boolean; trial_ends_at: string | null }, now: Date = new Date()): TrialBanner {
  if (!b.usable) return { kind: 'ended', status: b.status === 'canceled' ? 'canceled' : 'trialing' };
  if (b.status !== 'trialing') return null;
  const days = daysUntil(b.trial_ends_at, now);
  return days !== null && days <= 3 ? { kind: 'ending', days: Math.max(0, days) } : null;
}

export const STATUS_TEXT: Readonly<Record<string, string>> = {
  trialing: 'Em teste',
  active: 'Ativo',
  past_due: 'Pagamento pendente',
  canceled: 'Cancelado',
};
