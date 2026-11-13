import { formatKpiValue, formatTrend } from './kpi-format';

/** Intl usa espaço não separável; normaliza para comparar. */
const norm = (s: string) => s.replace(/\u00a0|\u202f/g, ' ');

describe('formatTrend', () => {
  it('alta em indicador "maior é melhor" é positiva com ▲', () => {
    const t = formatTrend(0.08);
    expect(t.arrow).toBe('▲');
    expect(t.text).toBe('8%');
    expect(t.sentiment).toBe('positive');
    expect(t.description).toContain('favorável');
  });

  it('alta em indicador "menor é melhor" (ex.: CPA) é negativa', () => {
    const t = formatTrend(0.12, 'down-is-good');
    expect(t.arrow).toBe('▲');
    expect(t.sentiment).toBe('negative');
    expect(t.description).toContain('desfavorável');
  });

  it('queda em indicador "menor é melhor" é positiva com ▼', () => {
    const t = formatTrend(-0.06, 'down-is-good');
    expect(t.arrow).toBe('▼');
    expect(t.text).toBe('6%');
    expect(t.sentiment).toBe('positive');
  });

  it('usa vírgula decimal do pt-BR', () => {
    expect(formatTrend(-0.125).text).toBe('12,5%');
  });

  it('variações abaixo de 0,5% e valores inválidos são neutros', () => {
    expect(formatTrend(0.004)).toMatchObject({ arrow: '–', sentiment: 'neutral' });
    expect(formatTrend(Number.NaN)).toMatchObject({ arrow: '–', sentiment: 'neutral' });
  });
});

describe('formatKpiValue', () => {
  it('moeda sem centavos a partir de mil, com centavos abaixo', () => {
    expect(norm(formatKpiValue(48240, 'currency'))).toBe('R$ 48.240');
    expect(norm(formatKpiValue(9.39, 'currency'))).toBe('R$ 9,39');
  });

  it('compacto em pt-BR', () => {
    expect(norm(formatKpiValue(48200, 'compact'))).toBe('48,2 mil');
  });

  it('decimal e percentual', () => {
    expect(formatKpiValue(4.1, 'decimal')).toBe('4,1');
    expect(formatKpiValue(0.237, 'percent')).toBe('23,7%');
  });

  it('valor não finito vira travessão', () => {
    expect(formatKpiValue(Number.POSITIVE_INFINITY, 'number')).toBe('—');
  });
});
