import { AttentionSignal } from '../../core/api/api.types';

type Evidence = AttentionSignal['evidence'];

const NUM = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** De onde veio o sinal (as regras de boas práticas não levam rótulo). */
export function signalSource(rule: string): string | null {
  if (rule.startsWith('benchmark.')) return 'Referência do nicho';
  if (rule.startsWith('history.')) return 'Histórico do cliente';
  if (rule.startsWith('tracking.')) return 'Qualidade dos dados';
  return null;
}

export interface BenchmarkBar {
  /** Posições de 0 a 1 na barra. */
  bandStart: number;
  bandEnd: number;
  median: number;
  value: number;
  rangeText: string;
  valueText: string;
}

/** Barra "faixa do nicho (p25–p75) × valor do período" para sinais benchmark.* */
export function benchmarkBar(evidence: Evidence): BenchmarkBar | null {
  const p25 = num(evidence['p25']);
  const p50 = num(evidence['p50']);
  const p75 = num(evidence['p75']);
  const value = num(evidence['value']);
  if (p25 === null || p50 === null || p75 === null || value === null || p75 <= p25) return null;

  const min = Math.min(p25, value) * 0.8;
  const max = Math.max(p75, value) * 1.15;
  const span = max - min || 1;
  const pos = (x: number) => Math.max(0, Math.min(1, (x - min) / span));

  return {
    bandStart: pos(p25),
    bandEnd: pos(p75),
    median: pos(p50),
    value: pos(value),
    rangeText: `Faixa do nicho: ${NUM.format(p25)} a ${NUM.format(p75)}`,
    valueText: `Este período: ${NUM.format(value)}`,
  };
}

/** "Habitual 2 → últimos 7 dias 1,2 (−40%)" para sinais history.* */
export function historyText(evidence: Evidence): string | null {
  const median = num(evidence['median']);
  const recent = num(evidence['recent']);
  const deviation = num(evidence['deviation_pct']);
  if (median === null || recent === null) return null;
  const pct = deviation === null ? '' : ` (${deviation > 0 ? '+' : '−'}${NUM.format(Math.abs(deviation))}%)`;
  return `Habitual: ${NUM.format(median)} → últimos 7 dias: ${NUM.format(recent)}${pct}`;
}
