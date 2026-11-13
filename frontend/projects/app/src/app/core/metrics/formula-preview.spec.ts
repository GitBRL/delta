import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CustomMetricPreviewBody, MetricResult } from '../api/api.types';
import { FormulaPreview, createFormulaPreview } from './formula-preview';

const body = (formula: string): CustomMetricPreviewBody => ({
  formula,
  unit: 'decimal',
  direction: 'higher_is_better',
  decimals: 2,
  project_id: 'p1',
  start: '2026-10-13',
  end: '2026-11-11',
  compare: 'previous_period',
});

const result = (value: number): MetricResult => ({
  key: 'custom:__preview',
  label: 'Preview',
  unit: 'decimal',
  direction: 'higher_is_better',
  decimals: 2,
  value,
  previous: null,
  change_pct: null,
  sentiment: 'neutral',
  approximate: false,
  series: [],
  previous_series: [],
});

describe('createFormulaPreview', () => {
  let backend: HttpTestingController;
  let preview: FormulaPreview;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    backend = TestBed.inject(HttpTestingController);
    preview = TestBed.runInInjectionContext(() => createFormulaPreview(400));
  });

  afterEach(() => {
    backend.verify();
    vi.useRealTimers();
  });

  const schedule = (formula: string | null) =>
    preview.schedule(formula === null ? null : { tenantId: 't1', body: body(formula) });

  it('agrupa digitação rápida em uma única requisição, com a última fórmula', () => {
    schedule('m');
    vi.advanceTimersByTime(150);
    schedule('meta_ads:sp');
    vi.advanceTimersByTime(150);
    schedule('meta_ads:spend');
    vi.advanceTimersByTime(399);
    backend.expectNone('/api/custom-metrics/preview');

    vi.advanceTimersByTime(1);
    const req = backend.expectOne('/api/custom-metrics/preview');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    expect(req.request.body.formula).toBe('meta_ads:spend');
    expect(preview.state()).toEqual({ status: 'loading', previous: null });

    req.flush({ data: result(3.2) });
    expect(preview.state()).toEqual({ status: 'ready', result: result(3.2) });
  });

  it('cancela a requisição anterior quando a fórmula muda (resposta velha nunca vence)', () => {
    schedule('meta_ads:spend');
    vi.advanceTimersByTime(400);
    const first = backend.expectOne('/api/custom-metrics/preview');
    first.flush({ data: result(1) });

    schedule('meta_ads:spend * 2');
    vi.advanceTimersByTime(400);
    const second = backend.expectOne('/api/custom-metrics/preview');
    // enquanto recalcula, mantém o último resultado para exibir esmaecido
    expect(preview.state()).toEqual({ status: 'loading', previous: result(1) });

    schedule('meta_ads:spend * 3');
    vi.advanceTimersByTime(400);
    expect(second.cancelled).toBe(true);

    backend.expectOne('/api/custom-metrics/preview').flush({ data: result(3) });
    expect(preview.state()).toEqual({ status: 'ready', result: result(3) });
  });

  it('traduz 422 de fórmula na mensagem do backend', () => {
    schedule('meta_ads:spend +');
    vi.advanceTimersByTime(400);
    backend
      .expectOne('/api/custom-metrics/preview')
      .flush(
        { message: 'Fórmula inválida', errors: { formula: ['A fórmula termina de forma incompleta.'] } },
        { status: 422, statusText: 'Unprocessable Content' },
      );

    expect(preview.state()).toEqual({ status: 'invalid', message: 'A fórmula termina de forma incompleta.' });
  });

  it('volta ao estado ocioso sem requisição quando não há o que calcular', () => {
    schedule(null);
    vi.advanceTimersByTime(400);
    backend.expectNone('/api/custom-metrics/preview');
    expect(preview.state()).toEqual({ status: 'idle' });
  });
});
