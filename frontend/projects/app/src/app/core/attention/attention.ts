import { HttpResourceRequest } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { StatusLevel } from 'design-system';
import {
  API,
  AttentionSignal,
  AttentionStatus,
  AttentionSummary,
  DateRange,
  ProjectGoals,
  SignalStatus,
  TENANT_HEADER,
  UpdateProjectBody,
} from '../api/api.types';

/** Monta a avaliação do semáforo de um projeto (POST /api/projects/{id}/attention). */
@Injectable({ providedIn: 'root' })
export class AttentionService {
  /** Corpo: só o período (a comparação é sempre com o período anterior). */
  buildBody(range: DateRange): DateRange {
    return { start: range.start, end: range.end };
  }

  /** Requisição para httpResource (POST com o header da agência). */
  request(projectId: string, tenantId: string, range: DateRange): HttpResourceRequest {
    return {
      url: API.projectAttention(projectId),
      method: 'POST',
      body: this.buildBody(range),
      headers: { [TENANT_HEADER]: tenantId },
    };
  }
}

/* ---------- Resumo e ordenação ---------- */

const SEVERITY: Record<AttentionStatus, number> = { critical: 3, attention: 2, opportunity: 1, healthy: 0 };

const SUMMARY_LABEL: Record<SignalStatus, [singular: string, plural: string]> = {
  critical: ['crítico', 'críticos'],
  attention: ['em atenção', 'em atenção'],
  opportunity: ['oportunidade', 'oportunidades'],
};

export interface SummaryChip {
  status: SignalStatus;
  count: number;
  /** Ex.: "2 críticos", "1 oportunidade". */
  text: string;
}

/** Chips do resumo na ordem de urgência; estados sem ocorrência ficam de fora. */
export function summaryChips(summary: AttentionSummary): SummaryChip[] {
  return (['critical', 'attention', 'opportunity'] as const)
    .filter((status) => summary[status] > 0)
    .map((status) => {
      const count = summary[status];
      const [singular, plural] = SUMMARY_LABEL[status];
      return { status, count, text: `${count} ${count === 1 ? singular : plural}` };
    });
}

/** Do mais urgente para o menos, estável entre sinais do mesmo nível (a API já ordena; isto é defesa). */
export function sortSignals(signals: readonly AttentionSignal[]): AttentionSignal[] {
  return signals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => SEVERITY[b.signal.status] - SEVERITY[a.signal.status] || a.index - b.index)
    .map(({ signal }) => signal);
}

/** Estado de uma métrica para o selo do KPI; `null` quando a métrica não foi avaliada. */
export function statusFor(statuses: Readonly<Record<string, AttentionStatus>> | null, metricKey: string): StatusLevel | null {
  return statuses?.[metricKey] ?? null;
}

/* ---------- Metas do projeto ---------- */

const twoDecimals = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const upToOneDecimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** ROAS mínimo para não ter prejuízo: 100 ÷ margem bruta (%). `null` fora de 0 < margem ≤ 100. */
export function breakEvenRoas(marginPct: number | null): number | null {
  if (marginPct === null || !Number.isFinite(marginPct) || marginPct <= 0 || marginPct > 100) return null;
  return 100 / marginPct;
}

/** Ex.: "Com margem de 40%, ROAS abaixo de 2,50 é prejuízo." */
export function breakEvenExplanation(marginPct: number | null): string | null {
  const roas = breakEvenRoas(marginPct);
  if (roas === null || marginPct === null) return null;
  return `Com margem de ${upToOneDecimal.format(marginPct)}%, ROAS abaixo de ${twoDecimals.format(roas)} é prejuízo.`;
}

/**
 * Número digitado em pt-BR: "40", "40,5", "1.234,56" ou "40.5". Vazio → `null`; inválido → NaN.
 */
export function parseDecimal(input: string): number | null {
  const text = input.trim().replace(/\s|R\$|%/g, '');
  if (text === '') return null;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

export interface GoalsForm {
  gross_margin_pct: string;
  target_cpa: string;
  target_roas: string;
}

const GOAL_FIELDS = ['gross_margin_pct', 'target_cpa', 'target_roas'] as const;

/** Valores atuais (da API) como texto para o formulário; vazio quando não informados. */
export function goalsToForm(goals: ProjectGoals | null | undefined): GoalsForm {
  const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value).replace('.', ','));
  return {
    gross_margin_pct: text(goals?.gross_margin_pct),
    target_cpa: text(goals?.target_cpa),
    target_roas: text(goals?.target_roas),
  };
}

/** Erros de cliente no mesmo formato de chave do 422 do Laravel ("goals.gross_margin_pct"). */
export function validateGoals(form: GoalsForm): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of GOAL_FIELDS) {
    const value = parseDecimal(form[field]);
    if (value === null) continue;
    if (Number.isNaN(value)) errors[`goals.${field}`] = 'Use apenas números (ex.: 40 ou 40,5).';
    else if (value <= 0) errors[`goals.${field}`] = 'Precisa ser maior que zero.';
    else if (field === 'gross_margin_pct' && value > 100) errors[`goals.${field}`] = 'A margem bruta vai de 0 a 100%.';
  }
  return errors;
}

/** Corpo do PATCH: campos vazios viram `null` (apaga a meta no backend). Assume formulário válido. */
export function buildGoalsBody(form: GoalsForm): UpdateProjectBody {
  const goals: ProjectGoals = { gross_margin_pct: null, target_cpa: null, target_roas: null };
  for (const field of GOAL_FIELDS) {
    goals[field] = parseDecimal(form[field]);
  }
  return { goals };
}
