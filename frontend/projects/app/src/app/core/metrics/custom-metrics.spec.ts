import { CustomMetric, MetricDefinition, Provider } from '../api/api.types';
import {
  EMPTY_DRAFT,
  buildCustomMetricBody,
  buildPreviewBody,
  formulaOptions,
  referenceLabels,
  relevantCustomMetrics,
} from './custom-metrics';

const custom = (key: string, providers: string[]): CustomMetric => ({
  id: key,
  key,
  name: key,
  description: null,
  formula: '1',
  unit: 'decimal',
  direction: 'higher_is_better',
  decimals: 2,
  providers,
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:00:00Z',
});

describe('corpos de requisição', () => {
  it('limpa espaços, transforma descrição vazia em null e limita as casas', () => {
    expect(
      buildCustomMetricBody({
        ...EMPTY_DRAFT,
        name: '  ROAS combinado ',
        description: '   ',
        formula: ' meta_ads:conversion_value / meta_ads:spend \n',
        decimals: 9,
      }),
    ).toEqual({
      name: 'ROAS combinado',
      description: null,
      formula: 'meta_ads:conversion_value / meta_ads:spend',
      unit: 'decimal',
      direction: 'higher_is_better',
      decimals: 6,
    });
  });

  it('monta o preview com projeto, período e comparação', () => {
    expect(
      buildPreviewBody(
        { ...EMPTY_DRAFT, formula: 'meta_ads:spend', unit: 'currency', direction: 'neutral', decimals: -1 },
        'p1',
        { start: '2026-10-13', end: '2026-11-11' },
        'previous_year',
      ),
    ).toEqual({
      formula: 'meta_ads:spend',
      unit: 'currency',
      direction: 'neutral',
      decimals: 0,
      project_id: 'p1',
      start: '2026-10-13',
      end: '2026-11-11',
      compare: 'previous_year',
    });
  });
});

describe('relevantCustomMetrics', () => {
  it('mantém os que usam alguma plataforma vinculada e os que não dependem de plataforma', () => {
    const list = [
      custom('custom:meta', ['meta_ads']),
      custom('custom:cruzado', ['meta_ads', 'google_ads']),
      custom('custom:ga4', ['ga4']),
      custom('custom:constante', []),
    ];

    expect(relevantCustomMetrics(list, ['google_ads', 'google_ads']).map((m) => m.key)).toEqual([
      'custom:cruzado',
      'custom:constante',
    ]);
    expect(relevantCustomMetrics(list, []).map((m) => m.key)).toEqual(['custom:constante']);
  });
});

describe('opções e rótulos', () => {
  const catalog: MetricDefinition[] = [
    {
      key: 'meta_ads:spend',
      provider: 'meta_ads',
      label: 'Investimento',
      description: '',
      unit: 'currency',
      kind: 'additive',
      direction: 'neutral',
      decimals: 2,
      featured: true,
    },
  ];
  const providers: Provider[] = [
    { key: 'meta_ads', name: 'Meta Ads', category: 'ads', available_modes: ['sandbox'], metrics_count: 1, featured_metrics: [] },
  ];

  it('oferece as métricas da fonte manual nas fórmulas e nos rótulos', () => {
    const manual = { id: 'mm1', key: 'manual:vendas_na_loja', name: 'Vendas na loja', description: null, unit: 'currency' as const, direction: 'higher_is_better' as const, decimals: 2, aggregation: 'sum' as const, created_at: '' };
    const options = formulaOptions(catalog, providers, [], undefined, [manual]);
    expect(options.find((o) => o.key === 'manual:vendas_na_loja')).toMatchObject({ group: 'Dados manuais', kind: 'metric', label: 'Vendas na loja' });
    expect(referenceLabels(catalog, [], [manual]).get('manual:vendas_na_loja')).toBe('Vendas na loja');
  });

  it('agrupa por plataforma, inclui indicadores e funções, e tira o próprio indicador em edição', () => {
    const options = formulaOptions(catalog, providers, [custom('custom:a', []), custom('custom:b', [])], 'custom:b');

    expect(options.find((o) => o.key === 'meta_ads:spend')).toMatchObject({ group: 'Meta Ads', kind: 'metric' });
    expect(options.filter((o) => o.kind === 'custom').map((o) => o.key)).toEqual(['custom:a']);
    expect(options.filter((o) => o.kind === 'function').map((o) => o.key)).toEqual([
      'sum',
      'min',
      'max',
      'abs',
      'round',
      'coalesce',
    ]);
  });

  it('dá nome legível às referências', () => {
    const labels = referenceLabels(catalog, [{ ...custom('custom:a', []), name: 'ROAS total' }]);
    expect(labels.get('meta_ads:spend')).toBe('Investimento');
    expect(labels.get('custom:a')).toBe('ROAS total');
  });
});
