import { TestBed } from '@angular/core/testing';
import { Account, Provider } from '../api/api.types';
import { MAX_METRICS_PER_QUERY, MetricsQueryService, formatterFor, kpiDirection } from './metrics-query.service';

const PROVIDERS: Provider[] = [
  {
    key: 'meta_ads',
    name: 'Meta Ads',
    category: 'ads',
    available_modes: ['sandbox'],
    metrics_count: 16,
    featured_metrics: ['meta_ads:spend', 'meta_ads:conversions', 'meta_ads:cpa', 'meta_ads:roas'],
  },
  {
    key: 'google_ads',
    name: 'Google Ads',
    category: 'ads',
    available_modes: ['sandbox'],
    metrics_count: 14,
    featured_metrics: ['google_ads:cost', 'google_ads:conversions'],
  },
  {
    key: 'ga4',
    name: 'Google Analytics 4',
    category: 'analytics',
    available_modes: ['sandbox'],
    metrics_count: 12,
    featured_metrics: ['ga4:sessions', 'ga4:engagement_rate'],
  },
];

const account = (provider: string, id: string): Account => ({
  id,
  provider,
  name: `Conta ${id}`,
  kind: 'ad_account',
  currency: 'BRL',
  external_id: `ext-${id}`,
});

describe('MetricsQueryService', () => {
  let service: MetricsQueryService;

  beforeEach(() => {
    service = TestBed.inject(MetricsQueryService);
  });

  it('monta o corpo da consulta no formato do contrato', () => {
    const body = service.buildBody(
      { start: '2026-11-05', end: '2026-11-11' },
      'previous_period',
      ['meta_ads:spend', 'meta_ads:cpa'],
    );

    expect(body).toEqual({
      start: '2026-11-05',
      end: '2026-11-11',
      compare: 'previous_period',
      metrics: ['meta_ads:spend', 'meta_ads:cpa'],
      series: true,
    });
  });

  it('remove métricas repetidas ou vazias e respeita o limite do backend', () => {
    const many = Array.from({ length: 50 }, (_, i) => `meta_ads:m${i}`);
    const body = service.buildBody({ start: '2026-11-01', end: '2026-11-01' }, 'none', [
      'meta_ads:spend',
      ' meta_ads:spend ',
      '',
      ...many,
    ]);

    expect(body.metrics[0]).toBe('meta_ads:spend');
    expect(body.metrics.filter((m) => m === 'meta_ads:spend').length).toBe(1);
    expect(body.metrics.length).toBe(MAX_METRICS_PER_QUERY);
  });

  it('gera a requisição POST com o header da agência', () => {
    const body = service.buildBody({ start: '2026-11-01', end: '2026-11-07' }, 'previous_year', ['ga4:sessions']);
    const req = service.request('p 1', 't1', body);

    expect(req.url).toBe('/api/projects/p%201/metrics/query');
    expect(req.method).toBe('POST');
    expect(req.body).toBe(body);
    expect(req.headers).toEqual({ 'X-Tenant-Id': 't1' });
  });

  it('usa as métricas em destaque só dos canais com conta vinculada, na ordem do catálogo', () => {
    const metrics = service.featuredMetricsFor([account('ga4', 'a1'), account('meta_ads', 'a2'), account('meta_ads', 'a3')], PROVIDERS);

    expect(metrics).toEqual([
      'meta_ads:spend',
      'meta_ads:conversions',
      'meta_ads:cpa',
      'meta_ads:roas',
      'ga4:sessions',
      'ga4:engagement_rate',
    ]);
    expect(service.featuredMetricsFor([], PROVIDERS)).toEqual([]);
  });
});

describe('helpers de métrica', () => {
  it('converte a direção da API para o KPI tile', () => {
    expect(kpiDirection('lower_is_better')).toBe('down-is-good');
    expect(kpiDirection('higher_is_better')).toBe('up-is-good');
    expect(kpiDirection('neutral')).toBe('up-is-good');
  });

  it('reaproveita o mesmo formatador para a mesma unidade e casas', () => {
    expect(formatterFor('currency', 2)).toBe(formatterFor('currency', 2));
    expect(formatterFor('percent', 1)(3.5)).toBe('3,5%');
  });
});
