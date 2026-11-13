import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { CustomMetric, Me, MetricDefinition, MetricResult } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { resolvePreset } from '../../core/metrics/period';
import { IndicatorEditorPage } from './indicator-editor.page';

const ME: Me = {
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role: 'owner' }],
};

const CATALOG: MetricDefinition[] = [
  { key: 'meta_ads:spend', provider: 'meta_ads', label: 'Investimento', description: '', unit: 'currency', kind: 'additive', direction: 'neutral', decimals: 2, featured: true },
  { key: 'meta_ads:conversion_value', provider: 'meta_ads', label: 'Valor de conversão', description: '', unit: 'currency', kind: 'additive', direction: 'higher_is_better', decimals: 2, featured: false },
];

const EXISTING: CustomMetric = {
  id: 'cm1',
  key: 'custom:roas_meta',
  name: 'ROAS Meta',
  description: null,
  formula: 'meta_ads:conversion_value / meta_ads:spend',
  unit: 'decimal',
  direction: 'higher_is_better',
  decimals: 2,
  providers: ['meta_ads'],
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:00:00Z',
};

const RESULT: MetricResult = {
  key: 'custom:__preview',
  label: 'Preview',
  unit: 'decimal',
  direction: 'higher_is_better',
  decimals: 2,
  value: 2.99,
  previous: 3.14,
  change_pct: -4.78,
  sentiment: 'negative',
  approximate: false,
  series: [{ date: '2026-11-11', value: 3 }],
  previous_series: [{ date: '2026-10-12', value: 3.1 }],
};

describe('IndicatorEditorPage', () => {
  let fixture: ComponentFixture<IndicatorEditorPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }

  async function setup(inputs: { id?: string; modelo?: string } = {}): Promise<void> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(ME), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(IndicatorEditorPage);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    el = fixture.nativeElement as HTMLElement;
    await tick();

    backend.expectOne('/api/metrics/catalog').flush({ data: CATALOG });
    backend.expectOne('/api/providers').flush({
      data: [{ key: 'meta_ads', name: 'Meta Ads', category: 'ads', available_modes: ['sandbox'], metrics_count: 2, featured_metrics: [] }],
    });
    backend.expectOne('/api/custom-metrics').flush({ data: [EXISTING] });
    backend.expectOne('/api/manual-metrics').flush({
      data: [{ id: 'mm1', key: 'manual:vendas_na_loja', name: 'Vendas na loja', description: null, unit: 'currency', direction: 'higher_is_better', decimals: 2, aggregation: 'sum', created_at: '2026-11-01T10:00:00Z' }],
    });
    backend.expectOne('/api/projects').flush({
      data: [{ id: 'p1', name: 'Loja Aurora', niche: null, created_at: '2026-11-01T10:00:00Z' }],
    });
    await tick();
  }

  afterEach(() => backend.verify());

  async function typeFormula(text: string): Promise<void> {
    const area = el.querySelector<HTMLTextAreaElement>('app-formula-field textarea')!;
    area.value = text;
    area.setSelectionRange(text.length, text.length);
    area.dispatchEvent(new Event('input'));
    await tick();
  }

  async function typeName(text: string): Promise<void> {
    const input = el.querySelector<HTMLInputElement>('ds-text-field input')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await tick();
  }

  /** Espera o debounce do preview e responde a requisição. */
  async function answerPreview(respond: (req: ReturnType<HttpTestingController['expectOne']>) => void) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    TestBed.tick();
    respond(backend.expectOne('/api/custom-metrics/preview'));
    await tick();
    await fixture.whenStable();
  }

  it('calcula o preview com o projeto e o período escolhidos e cria o indicador', async () => {
    await setup();
    await typeName('ROAS Meta 2');
    await typeFormula('meta_ads:conversion_value / meta_ads:spend');

    await answerPreview((req) => {
      expect(req.request.body).toEqual({
        formula: 'meta_ads:conversion_value / meta_ads:spend',
        unit: 'decimal',
        direction: 'higher_is_better',
        decimals: 2,
        project_id: 'p1',
        ...resolvePreset('last_30'),
        compare: 'previous_period',
      });
      req.flush({ data: RESULT });
    });

    expect(el.querySelector('.result ds-kpi-tile')).not.toBeNull();
    expect(el.querySelector('.result ds-area-chart')).not.toBeNull();
    // "Como o Delta lê" traduz as referências
    expect(el.querySelector('.reading')?.textContent).toContain('Valor de conversão');

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await tick();

    const req = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/custom-metrics');
    expect(req.request.body).toEqual({
      name: 'ROAS Meta 2',
      description: null,
      formula: 'meta_ads:conversion_value / meta_ads:spend',
      unit: 'decimal',
      direction: 'higher_is_better',
      decimals: 2,
    });
    req.flush({ data: { ...EXISTING, id: 'cm2', key: 'custom:roas_meta_2', name: 'ROAS Meta 2' } }, { status: 201, statusText: 'Created' });
    await tick();
    expect(navigate).toHaveBeenCalledWith(['/indicadores']);
  });

  it('mostra o 422 de fórmula junto do campo, sem apagar o que foi digitado', async () => {
    await setup();
    await typeName('Quebrado');
    await typeFormula('meta_ads:spend +');

    await answerPreview((req) =>
      req.flush(
        { message: 'Fórmula inválida', errors: { formula: ['A fórmula termina de forma incompleta.'] } },
        { status: 422, statusText: 'Unprocessable Content' },
      ),
    );

    expect(el.querySelector('app-formula-field .server-error')?.textContent?.trim()).toBe(
      'A fórmula termina de forma incompleta.',
    );
    expect(el.querySelector<HTMLTextAreaElement>('app-formula-field textarea')!.value).toBe('meta_ads:spend +');
    expect(el.querySelector('.placeholder.invalid')?.textContent).toContain('Corrija a fórmula');

    // salvar devolve o mesmo erro do backend no campo
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await tick();
    backend
      .expectOne((r) => r.method === 'POST' && r.url === '/api/custom-metrics')
      .flush(
        { message: 'Dados inválidos', errors: { formula: ['Referência desconhecida: meta_ads:x'] } },
        { status: 422, statusText: 'Unprocessable Content' },
      );
    await tick();
    await fixture.whenStable();
    expect(el.querySelector('app-formula-field .server-error')?.textContent?.trim()).toBe(
      'Referência desconhecida: meta_ads:x',
    );
  });

  it('edita um indicador existente com PUT, sem oferecer a si mesmo no autocompletar', async () => {
    await setup({ id: 'cm1' });
    await fixture.whenStable();

    expect(el.querySelector('h1')?.textContent).toContain('ROAS Meta');
    expect(el.textContent).toContain('custom:roas_meta');
    const area = el.querySelector<HTMLTextAreaElement>('app-formula-field textarea')!;
    expect(area.value).toBe(EXISTING.formula);

    await answerPreview((req) => req.flush({ data: RESULT }));

    await typeFormula('roas');
    expect(el.querySelectorAll('app-formula-field [role=option]').length).toBe(0);
    await typeFormula(EXISTING.formula + ' * 100');
    await answerPreview((req) => req.flush({ data: RESULT }));

    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await tick();
    const req = backend.expectOne((r) => r.method === 'PUT' && r.url === '/api/custom-metrics/cm1');
    expect(req.request.body.formula).toBe(EXISTING.formula + ' * 100');
    req.flush({ data: EXISTING });
    await tick();
  });

  it('preenche a partir de um modelo (?modelo=)', async () => {
    await setup({ modelo: 'Investimento total em mídia' });
    backend.expectOne('/api/custom-metrics/templates').flush({
      data: [
        {
          name: 'Investimento total em mídia',
          description: 'Meta + Google',
          formula: 'sum(meta_ads:spend, google_ads:cost)',
          unit: 'currency',
          direction: 'neutral',
          decimals: 2,
        },
      ],
    });
    await tick();
    await fixture.whenStable();

    expect(el.querySelector<HTMLTextAreaElement>('app-formula-field textarea')!.value).toBe(
      'sum(meta_ads:spend, google_ads:cost)',
    );
    expect(el.querySelector<HTMLInputElement>('ds-text-field input')!.value).toBe('Investimento total em mídia');

    await answerPreview((req) => {
      expect(req.request.body.unit).toBe('currency');
      req.flush({ data: RESULT });
    });
  });
});
