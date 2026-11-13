import { buildChartGeometry, nearestIndex, niceMax, xTickIndexes } from './chart-geometry';

const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };

describe('niceMax', () => {
  it('arredonda para cima em degraus legíveis', () => {
    expect(niceMax(10)).toBe(10);
    expect(niceMax(48)).toBe(50);
    expect(niceMax(1240)).toBe(2000);
    expect(niceMax(0.3)).toBe(0.5);
    expect(niceMax(0)).toBe(1);
  });
});

describe('buildChartGeometry', () => {
  const series = [
    { date: '2026-11-01', value: 0 },
    { date: '2026-11-02', value: 10 },
    { date: '2026-11-03', value: 5 },
  ];

  it('gera linha e área a partir dos pontos', () => {
    const g = buildChartGeometry(series, [], { width: 200, height: 100, padding: NO_PADDING });

    expect(g.max).toBe(10);
    expect(g.linePath).toBe('M0 100 L100 0 L200 50');
    expect(g.areaPath).toBe('M0 100 L0 100 L100 0 L200 50 L200 100 Z');
    expect(g.comparisonPath).toBe('');
  });

  it('abre lacunas na linha quando falta valor', () => {
    const g = buildChartGeometry(
      [
        { date: 'a', value: 2 },
        { date: 'b', value: null },
        { date: 'c', value: 4 },
        { date: 'd', value: 8 },
      ],
      [],
      { width: 300, height: 100, padding: NO_PADDING },
    );

    // máximo "bonito" de 8 é 10 → y = 100 × (1 − v/10)
    expect(g.linePath).toBe('M0 80 M200 60 L300 20');
    expect(g.points[1].y).toBeNull();
  });

  it('usa a mesma escala para as duas séries e alinha por índice', () => {
    const g = buildChartGeometry(series, [
      { date: '2026-10-01', value: 20 },
      { date: '2026-10-02', value: 0 },
    ], { width: 200, height: 100, padding: NO_PADDING });

    expect(g.max).toBe(20);
    expect(g.comparisonPath).toBe('M0 0 L100 100');
    expect(g.linePath).toBe('M0 100 L100 50 L200 75');
  });

  it('distribui marcações do eixo y entre mínimo e máximo', () => {
    const g = buildChartGeometry(series, [], { width: 200, height: 100, padding: NO_PADDING, yTickCount: 2 });
    expect(g.yTicks).toEqual([
      { value: 0, y: 100 },
      { value: 5, y: 50 },
      { value: 10, y: 0 },
    ]);
  });

  it('centraliza um único ponto', () => {
    const g = buildChartGeometry([{ date: 'a', value: 3 }], [], { width: 100, height: 50, padding: NO_PADDING });
    expect(g.points[0].x).toBe(50);
  });
});

describe('xTickIndexes', () => {
  it('inclui primeiro e último, uniformemente', () => {
    expect(xTickIndexes(30, 5)).toEqual([0, 7, 15, 22, 29]);
    expect(xTickIndexes(3, 5)).toEqual([0, 1, 2]);
    expect(xTickIndexes(0, 5)).toEqual([]);
  });
});

describe('nearestIndex', () => {
  it('converte a posição do ponteiro no índice mais próximo', () => {
    const plot = { left: 0, right: 300, top: 0, bottom: 100 };
    expect(nearestIndex(0, { plot, slots: 4 })).toBe(0);
    expect(nearestIndex(140, { plot, slots: 4 })).toBe(1);
    expect(nearestIndex(999, { plot, slots: 4 })).toBe(3);
    expect(nearestIndex(-50, { plot, slots: 4 })).toBe(0);
  });
});
