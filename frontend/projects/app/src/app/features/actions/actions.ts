import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ActionBody,
  ActionPatch,
  ActionStatus,
  ApiEnvelope,
  AttentionSignal,
  PlanAction,
} from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors } from '../../core/forms/server-errors';

/** Janela da medição de impacto (o backend mede 14 dias depois de aplicada). */
export const MEASURE_DAYS = 14;

export const ACTION_COLUMNS: readonly { status: ActionStatus; label: string; empty: string }[] = [
  { status: 'open', label: 'A fazer', empty: 'Nada pendente.' },
  { status: 'doing', label: 'Em andamento', empty: 'Nenhuma ação em andamento.' },
  { status: 'done', label: 'Aplicadas', empty: 'Ações aplicadas aparecem aqui, com o resultado medido.' },
  { status: 'dismissed', label: 'Descartadas', empty: 'Nenhuma sugestão descartada.' },
];

export function groupActions(actions: readonly PlanAction[]): Record<ActionStatus, PlanAction[]> {
  const groups: Record<ActionStatus, PlanAction[]> = { open: [], doing: [], done: [], dismissed: [] };
  for (const action of actions) groups[action.status]?.push(action);
  return groups;
}

/** Nomes em pt-BR das métricas mais comuns (o resto vira texto a partir da chave). */
const SUFFIX_LABEL: Readonly<Record<string, string>> = {
  spend: 'Investimento',
  cost: 'Investimento',
  conversions: 'Conversões',
  conversion_value: 'Valor de conversão',
  conversion_rate: 'Taxa de conversão',
  reach: 'Alcance',
  impressions: 'Impressões',
  clicks: 'Cliques',
  link_clicks: 'Cliques no link',
  frequency: 'Frequência',
  sessions: 'Sessões',
  followers: 'Seguidores',
  engagement_rate: 'Taxa de engajamento',
  key_events: 'Eventos-chave',
  session_conversion_rate: 'Taxa de conversão',
  leads: 'Leads',
  avg_cpc: 'CPC médio',
  purchase_revenue: 'Receita',
};

/** "meta_ads:cpa" → "CPA"; "manual:vendas_na_loja" → "Vendas na loja". */
export function metricName(key: string, labels: Readonly<Record<string, string>> = {}): string {
  if (labels[key]) return labels[key];
  const suffix = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
  if (SUFFIX_LABEL[suffix]) return SUFFIX_LABEL[suffix];
  if (suffix.length <= 4) return suffix.toUpperCase();
  const text = suffix.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const PCT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** Texto do resultado medido ("CPA caiu 18% depois desta ação") ou null se ainda não há. */
export function outcomeText(action: PlanAction, labels: Readonly<Record<string, string>> = {}): string | null {
  const change = action.outcome?.change_pct;
  if (change === null || change === undefined) return action.outcome ? 'Sem dados suficientes para medir o resultado.' : null;
  const name = metricName(action.metric_key, labels);
  if (change === 0) return `${name} não mudou depois desta ação`;
  return `${name} ${change > 0 ? 'subiu' : 'caiu'} ${PCT.format(Math.abs(change))}% depois desta ação`;
}

/** "Medindo… resultado em 9 dias" enquanto a janela de 14 dias não fecha. */
export function measuringText(action: PlanAction, today: Date = new Date()): string | null {
  if (action.status !== 'done' || action.outcome || !action.applied_at) return null;
  const applied = new Date(action.applied_at);
  const elapsed = Math.floor((today.getTime() - applied.getTime()) / 86_400_000);
  const left = MEASURE_DAYS - elapsed;
  return left > 1 ? `Medindo… resultado em ${left} dias` : 'Medindo… resultado em breve';
}

const SHORT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

/** "até 15 de nov." (e se já passou). */
export function dueText(due: string | null, today: Date = new Date()): { text: string; late: boolean } | null {
  if (!due) return null;
  const [y, m, d] = due.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return { text: `até ${SHORT.format(date)}`, late: date < start };
}

/** Ação pré-preenchida a partir de um sinal do semáforo. */
export function actionFromSignal(signal: AttentionSignal): ActionBody {
  return {
    rule: signal.rule,
    metric_key: signal.metric,
    title: signal.title,
    suggestion: signal.suggestion,
  };
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; fields: FieldErrors | null };

/**
 * Chamadas do plano de ação (criar, mudar e remover), com o tratamento de erro comum:
 * 422 volta como erros por campo; 403/5xx/rede já viram toast no interceptor global.
 */
@Injectable({ providedIn: 'root' })
export class ActionsApi {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);

  create(projectId: string, body: ActionBody): Promise<ActionResult<PlanAction>> {
    return this.run(this.http.post<ApiEnvelope<PlanAction>>(API.projectActions(projectId), body), 'Não foi possível criar a ação');
  }

  patch(id: string, body: ActionPatch): Promise<ActionResult<PlanAction>> {
    return this.run(this.http.patch<ApiEnvelope<PlanAction>>(API.action(id), body), 'Não foi possível atualizar a ação');
  }

  async remove(id: string): Promise<boolean> {
    try {
      await firstValueFrom(this.http.delete(API.action(id)));
      return true;
    } catch (error) {
      this.report(error, 'Não foi possível remover a ação');
      return false;
    }
  }

  private async run(
    request: ReturnType<HttpClient['post']>,
    title: string,
  ): Promise<ActionResult<PlanAction>> {
    try {
      const res = (await firstValueFrom(request)) as ApiEnvelope<PlanAction>;
      return { ok: true, data: res.data };
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (!fields) this.report(error, title);
      return { ok: false, fields };
    }
  }

  private report(error: unknown, title: string): void {
    const status = error instanceof HttpErrorResponse ? error.status : null;
    if (status !== 403 && status !== 0 && (status ?? 500) < 500) this.toast.error(title);
  }
}
