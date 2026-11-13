import { StatusLevel } from 'design-system';
import { Goal, GoalComparison, GoalPeriod, GoalProgress, GoalStatus } from '../../core/api/api.types';
import { formatterFor } from '../../core/metrics/metrics-query.service';

export interface GoalStatusMeta {
  label: string;
  /** Selo do semáforo (nulo = sem dados, chip neutro). */
  level: StatusLevel | null;
  /** Título do grupo na tela de metas. */
  group: string;
}

export const GOAL_STATUS: Readonly<Record<GoalStatus, GoalStatusMeta>> = {
  off_track: { label: 'Fora do ritmo', level: 'critical', group: 'Fora do ritmo' },
  at_risk: { label: 'Em risco', level: 'attention', group: 'Em risco' },
  no_data: { label: 'Sem dados', level: null, group: 'Sem dados' },
  on_track: { label: 'No ritmo', level: 'healthy', group: 'No ritmo' },
  achieved: { label: 'Meta batida', level: 'healthy', group: 'Batidas' },
};

/** Ordem dos grupos: o que pede ação primeiro. */
export const GOAL_STATUS_ORDER: readonly GoalStatus[] = ['off_track', 'at_risk', 'no_data', 'on_track', 'achieved'];

export const COMPARISON_LABEL: Readonly<Record<GoalComparison, string>> = {
  at_least: 'pelo menos',
  at_most: 'no máximo',
};

export const PERIOD_LABEL: Readonly<Record<GoalPeriod, string>> = {
  month: 'por mês',
  week: 'por semana',
};

export interface GoalBar {
  /** Preenchimento 0–1. */
  fill: number;
  /** Posição 0–1 do marcador (ritmo esperado ou meta) ou nulo. */
  marker: number | null;
  markerLabel: string;
  /** Passou do alvo (estourou o orçamento, por exemplo). */
  over: boolean;
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Geometria da barra:
 *  - métricas que acumulam (leads, investimento): escala = meta; marcador = ritmo esperado até hoje;
 *  - métricas de nível (CPA, ROAS): escala até um pouco além do maior entre valor e meta; marcador = meta.
 */
export function goalBar(p: GoalProgress, comparison: GoalComparison): GoalBar {
  const value = p.value ?? 0;
  if (p.cumulative) {
    const scale = p.target > 0 ? p.target : 1;
    const closedOrDone = p.period.closed;
    return {
      fill: clamp(value / scale),
      marker: closedOrDone ? null : clamp(p.expected / scale),
      markerLabel: 'ritmo esperado até hoje',
      over: comparison === 'at_most' && value > p.target,
    };
  }
  const scale = Math.max(p.target, value) * 1.15 || 1;
  return {
    fill: clamp(value / scale),
    marker: clamp(p.target / scale),
    markerLabel: 'meta',
    over: comparison === 'at_most' ? value > p.target : false,
  };
}

/** "Leads: 31 de 100 · projeção 93 · novembro de 2026" ou "CPA: R$ 54,00 (meta: no máximo R$ 50,00) · …" */
export function goalText(goal: Goal): string {
  const p = goal.progress;
  const fmt = formatterFor(p.unit, p.decimals);
  const show = (v: number | null) => (v === null || !Number.isFinite(v) ? '—' : fmt(v));
  const parts: string[] = [];

  if (p.cumulative) {
    parts.push(`${p.label}: ${show(p.value)} de ${show(p.target)}`);
    if (!p.period.closed && p.projection !== null && p.status !== 'achieved') parts.push(`projeção ${show(p.projection)}`);
  } else {
    parts.push(`${p.label}: ${show(p.value)} (meta: ${COMPARISON_LABEL[goal.comparison]} ${show(p.target)})`);
  }
  parts.push(p.period.label);
  return parts.join(' · ');
}

/** "pelo menos R$ 50.000,00 por mês" */
export function goalTargetText(goal: Pick<Goal, 'comparison' | 'target' | 'period'>, unit: GoalProgress['unit'], decimals: number): string {
  return `${COMPARISON_LABEL[goal.comparison]} ${formatterFor(unit, decimals)(goal.target)} ${PERIOD_LABEL[goal.period]}`;
}

/** Agrupa na ordem de urgência, mantendo a ordem do backend dentro de cada grupo. */
export function groupGoals(goals: readonly Goal[]): { status: GoalStatus; label: string; goals: Goal[] }[] {
  return GOAL_STATUS_ORDER.map((status) => ({
    status,
    label: GOAL_STATUS[status].group,
    goals: goals.filter((g) => g.progress.status === status),
  })).filter((group) => group.goals.length > 0);
}

/** Converte "1.234,56" / "1234.56" / "50" em número (nulo se inválido ou ≤ 0). */
export function parseTarget(text: string): number | null {
  const clean = text.replace(/[^\d,.-]/g, '');
  if (!clean) return null;
  const normalized =
    clean.includes(',') && (!clean.includes('.') || clean.lastIndexOf(',') > clean.lastIndexOf('.'))
      ? clean.replace(/\./g, '').replace(',', '.')
      : clean.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}
