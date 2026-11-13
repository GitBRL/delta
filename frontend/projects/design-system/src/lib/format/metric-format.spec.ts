import { formatCount, formatDuration, formatMetric, metricFormatter } from './metric-format';

/** Intl usa espaço não separável entre "R$" e o número; normalizamos para comparar. */
const n = (text: string) => text.replace(/\u00a0|\u202f/g, ' ');

describe('formatMetric', () => {
  it('formata moeda em reais com as casas pedidas', () => {
    expect(n(formatMetric(1240, 'currency', 2))).toBe('R$ 1.240,00');
    expect(n(formatMetric(9.385, 'currency', 2))).toBe('R$ 9,39');
    expect(n(formatMetric(1240, 'currency', 0))).toBe('R$ 1.240');
  });

  it('compacta valores monetários a partir de 1 milhão', () => {
    expect(n(formatMetric(1_234_567, 'currency', 2))).toBe('R$ 1,2 mi');
  });

  it('trata percentual como valor já em 0–100', () => {
    expect(formatMetric(3.5, 'percent', 1)).toBe('3,5%');
    expect(formatMetric(64, 'percent', 0)).toBe('64%');
  });

  it('compacta contagens a partir de 10 mil e mantém exatas abaixo disso', () => {
    expect(n(formatMetric(48_200, 'count'))).toBe('48,2 mil');
    expect(n(formatMetric(1_250_000, 'count'))).toBe('1,3 mi');
    expect(formatMetric(9_876, 'count')).toBe('9.876');
    expect(formatMetric(132, 'count')).toBe('132');
  });

  it('formata decimais com casas fixas', () => {
    expect(formatMetric(4.1, 'decimal', 2)).toBe('4,10');
    expect(formatMetric(3.6, 'decimal', 1)).toBe('3,6');
  });

  it('mostra travessão quando não há valor', () => {
    expect(formatMetric(null, 'currency')).toBe('—');
    expect(formatMetric(undefined, 'count')).toBe('—');
    expect(formatMetric(Number.NaN, 'percent')).toBe('—');
  });

  it('cria formatadores reutilizáveis', () => {
    const roas = metricFormatter('decimal', 2);
    expect(roas(4)).toBe('4,00');
  });
});

describe('formatDuration', () => {
  it('usa segundos, minutos e horas', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(125)).toBe('2 min 05 s');
    expect(formatDuration(3720)).toBe('1 h 02 min');
    expect(formatMetric(125.4, 'duration')).toBe('2 min 05 s');
  });
});

describe('formatCount', () => {
  it('arredonda contagens pequenas', () => {
    expect(formatCount(12.6)).toBe('13');
  });
});
