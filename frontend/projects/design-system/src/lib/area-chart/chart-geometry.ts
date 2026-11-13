/**
 * Geometria do gráfico de área (funções puras, testáveis sem DOM).
 * As séries são alinhadas por índice: o dia 1 do período atual fica sobre o dia 1 do anterior.
 */

export interface ChartPoint {
  date: string;
  value: number | null;
}

export interface PlottedPoint {
  index: number;
  date: string;
  value: number | null;
  x: number;
  /** null quando o ponto não tem valor (vira lacuna na linha). */
  y: number | null;
}

export interface ChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ChartOptions {
  width: number;
  height: number;
  padding?: Partial<ChartPadding>;
  xTickCount?: number;
  yTickCount?: number;
}

export interface ChartGeometry {
  width: number;
  height: number;
  plot: { left: number; top: number; right: number; bottom: number };
  /** Quantidade de posições no eixo x (maior das duas séries). */
  slots: number;
  min: number;
  max: number;
  points: PlottedPoint[];
  comparisonPoints: PlottedPoint[];
  linePath: string;
  areaPath: string;
  comparisonPath: string;
  yTicks: { value: number; y: number }[];
  xTicks: { index: number; x: number; date: string }[];
}

const DEFAULT_PADDING: ChartPadding = { top: 12, right: 12, bottom: 28, left: 56 };

/** Arredonda para 2 casas: caminhos estáveis e menores. */
function r(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Teto "bonito" para o eixo y: 1, 2, 2,5, 5 ou 10 × 10ⁿ. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const fraction = value / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * base;
}

export function buildChartGeometry(
  series: readonly ChartPoint[],
  comparison: readonly ChartPoint[],
  options: ChartOptions,
): ChartGeometry {
  const padding: ChartPadding = { ...DEFAULT_PADDING, ...options.padding };
  const width = Math.max(options.width, padding.left + padding.right + 1);
  const height = Math.max(options.height, padding.top + padding.bottom + 1);
  const plot = {
    left: padding.left,
    top: padding.top,
    right: width - padding.right,
    bottom: height - padding.bottom,
  };

  const slots = Math.max(series.length, comparison.length, 1);
  const values = [...series, ...comparison]
    .map((p) => p.value)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  const highest = values.length ? Math.max(...values) : 0;
  const lowest = values.length ? Math.min(...values) : 0;
  const max = niceMax(highest);
  const min = lowest < 0 ? -niceMax(-lowest) : 0;

  const xAt = (index: number): number =>
    slots === 1 ? (plot.left + plot.right) / 2 : plot.left + (index * (plot.right - plot.left)) / (slots - 1);
  const yAt = (value: number): number => plot.top + (plot.bottom - plot.top) * (1 - (value - min) / (max - min));

  const place = (list: readonly ChartPoint[]): PlottedPoint[] =>
    list.map((p, index) => ({
      index,
      date: p.date,
      value: p.value,
      x: r(xAt(index)),
      y: p.value === null || !Number.isFinite(p.value) ? null : r(yAt(p.value)),
    }));

  const points = place(series);
  const comparisonPoints = place(comparison);
  const baseline = r(yAt(Math.max(min, Math.min(0, max))));

  const yTickCount = Math.max(1, options.yTickCount ?? 4);
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => {
    const value = min + ((max - min) * i) / yTickCount;
    return { value, y: r(yAt(value)) };
  });

  return {
    width,
    height,
    plot,
    slots,
    min,
    max,
    points,
    comparisonPoints,
    linePath: linePath(points),
    areaPath: areaPath(points, baseline),
    comparisonPath: linePath(comparisonPoints),
    yTicks,
    xTicks: xTickIndexes(series.length, options.xTickCount ?? 5).map((index) => ({
      index,
      x: r(xAt(index)),
      date: series[index].date,
    })),
  };
}

/** Trechos contíguos de pontos com valor (lacunas separam trechos). */
function segments(points: readonly PlottedPoint[]): PlottedPoint[][] {
  const result: PlottedPoint[][] = [];
  let current: PlottedPoint[] = [];
  for (const p of points) {
    if (p.y === null) {
      if (current.length) result.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length) result.push(current);
  return result;
}

function linePath(points: readonly PlottedPoint[]): string {
  return segments(points)
    .map((seg) => seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' '))
    .join(' ');
}

function areaPath(points: readonly PlottedPoint[], baseline: number): string {
  return segments(points)
    .map((seg) => {
      const first = seg[0];
      const last = seg[seg.length - 1];
      const top = seg.map((p) => `L${p.x} ${p.y}`).join(' ');
      return `M${first.x} ${baseline} ${top} L${last.x} ${baseline} Z`;
    })
    .join(' ');
}

/** Índices dos rótulos do eixo x: primeiro, último e intermediários uniformes. */
export function xTickIndexes(length: number, count: number): number[] {
  if (length <= 0) return [];
  if (length <= count) return Array.from({ length }, (_, i) => i);
  const indexes = new Set<number>();
  for (let i = 0; i < count; i++) {
    indexes.add(Math.round((i * (length - 1)) / (count - 1)));
  }
  return [...indexes].sort((a, b) => a - b);
}

/** Índice mais próximo de uma coordenada x (para tooltip por ponteiro). */
export function nearestIndex(x: number, geometry: Pick<ChartGeometry, 'plot' | 'slots'>): number {
  const { plot, slots } = geometry;
  if (slots <= 1) return 0;
  const ratio = (x - plot.left) / (plot.right - plot.left);
  return Math.min(slots - 1, Math.max(0, Math.round(ratio * (slots - 1))));
}
