/**
 * Calculadoras gratuitas do site do Delta. Funções puras: usadas pelas páginas (navegador) e
 * pelos testes (Node). Valores em reais; percentuais em pontos (35 = 35%).
 */

/** ROAS mínimo para não ter prejuízo, dada a margem bruta. Margem 35% → ROAS 2,86. */
export function breakEvenRoas(marginPct) {
  if (!(marginPct > 0 && marginPct <= 100)) return null;
  return 100 / marginPct;
}

/** CPA máximo para empatar e CPA-alvo para manter o lucro desejado por venda. */
export function maxCpa(averageTicket, marginPct, targetProfitPct = 0) {
  if (!(averageTicket > 0) || !(marginPct > 0 && marginPct <= 100) || targetProfitPct < 0) return null;
  const breakEven = averageTicket * (marginPct / 100);
  const target = Math.max(0, averageTicket * ((marginPct - targetProfitPct) / 100));
  return { breakEven, target };
}

/** Preço da hora de freelancer: renda desejada + custos, sobre as horas faturáveis. */
export function freelanceRate({ monthlyIncome, monthlyCosts = 0, billableHoursPerWeek, weeksOff = 4, taxPct = 6 }) {
  if (!(monthlyIncome > 0) || !(billableHoursPerWeek > 0) || weeksOff < 0 || weeksOff >= 52 || taxPct < 0 || taxPct >= 100) return null;
  const annualNeed = (monthlyIncome + monthlyCosts) * 12;
  const billableHours = billableHoursPerWeek * (52 - weeksOff);
  const hourly = annualNeed / billableHours / (1 - taxPct / 100);
  return { hourly, monthlyRevenue: hourly * billableHours / 12, billableHours };
}

/** Funil: taxas de cada etapa e onde está o maior gargalo contra as referências informadas. */
export function funnel({ impressions, clicks, conversions }, reference = { ctr: 1.2, conversionRate: 2.5 }) {
  if (!(impressions > 0) || clicks < 0 || conversions < 0 || clicks > impressions || conversions > clicks) return null;
  const ctr = (clicks / impressions) * 100;
  const conversionRate = clicks > 0 ? (conversions / clicks) * 100 : 0;
  const gaps = [
    { stage: 'clique', value: ctr, reference: reference.ctr, ratio: ctr / reference.ctr },
    { stage: 'conversão', value: conversionRate, reference: reference.conversionRate, ratio: conversionRate / reference.conversionRate },
  ];
  const bottleneck = gaps.reduce((worst, g) => (g.ratio < worst.ratio ? g : worst));
  return { ctr, conversionRate, bottleneck: bottleneck.ratio < 1 ? bottleneck.stage : null };
}

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const format = {
  number: (v) => number.format(v),
  money: (v) => money.format(v),
  percent: (v) => `${number.format(v)}%`,
};
