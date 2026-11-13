export type KpiFormat = 'number' | 'compact' | 'currency' | 'percent' | 'decimal';

/** Qual sentido do indicador é bom: CPA, por exemplo, é melhor quando cai. */
export type KpiDirection = 'up-is-good' | 'down-is-good';

export type TrendSentiment = 'positive' | 'negative' | 'neutral';

export interface TrendView {
  arrow: '▲' | '▼' | '–';
  /** Variação absoluta formatada, sem sinal (ex.: "8%", "12,5%"). */
  text: string;
  sentiment: TrendSentiment;
  /** Frase para leitores de tela. */
  description: string;
}

const LOCALE = 'pt-BR';

/** Variações abaixo de 0,5% são tratadas como estáveis. */
const NEUTRAL_THRESHOLD = 0.005;

export function formatKpiValue(value: number, format: KpiFormat, currency = 'BRL'): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
        minimumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
      }).format(value);
    case 'percent':
      return new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 1 }).format(
        value,
      );
    case 'decimal':
      return new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
      }).format(value);
    case 'compact':
      return new Intl.NumberFormat(LOCALE, {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(value);
    case 'number':
    default:
      return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(value);
  }
}

/**
 * @param trend variação relativa (0.08 = +8%).
 * @param direction se subir é bom ou ruim para este indicador.
 */
export function formatTrend(
  trend: number,
  direction: KpiDirection = 'up-is-good',
  /** Sentimento já decidido por quem conhece a métrica (ex.: a API); prevalece sobre `direction`. */
  sentimentOverride: TrendSentiment | null = null,
): TrendView {
  if (!Number.isFinite(trend) || Math.abs(trend) < NEUTRAL_THRESHOLD) {
    return {
      arrow: '–',
      text: '0%',
      sentiment: 'neutral',
      description: 'Estável em relação ao período anterior',
    };
  }

  const text = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 1 }).format(
    Math.abs(trend),
  );
  const up = trend > 0;
  const sentiment: TrendSentiment =
    sentimentOverride ?? ((direction === 'up-is-good' ? up : !up) ? 'positive' : 'negative');
  const verdict =
    sentiment === 'positive' ? 'favorável' : sentiment === 'negative' ? 'desfavorável' : 'neutra';

  return {
    arrow: up ? '▲' : '▼',
    text,
    sentiment,
    description: `${up ? 'Alta' : 'Queda'} de ${text} em relação ao período anterior (${verdict})`,
  };
}
