import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { CustomMetric, Me, MetricDefinition } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { IndicatorsPage } from './indicators.page';

const me = (role: string): Me => ({
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const ROAS: CustomMetric = {
  id: 'cm1',
  key: 'custom:roas_combinado',
  name: 'ROAS combinado',
  description: 'Receita das duas plataformas sobre o investimento total.',
  formula: 'sum(meta_ads:conversion_value, google_ads:conversion_value) / sum(meta_ads:spend, google_ads:cost)',
  unit: 'decimal',
  direction: 'higher_is_better',
  decimals: 2,
  providers: ['meta_ads', 'google_ads'],
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:00:00Z',
};

const CATALOG: MetricDefinition[] = [
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

describe('IndicatorsPage', () => {
  let fixture: ComponentFixture<IndicatorsPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }

  async function setup(role = 'owner'): Promise<void> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(IndicatorsPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();

    backend.expectOne('/api/custom-metrics').flush({ data: [ROAS] });
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
    backend.expectOne('/api/metrics/catalog').flush({ data: CATALOG });
    backend.expectOne('/api/providers').flush({
      data: [
        { key: 'meta_ads', name: 'Meta Ads', category: 'ads', available_modes: ['sandbox'], metrics_count: 1, featured_metrics: [] },
        { key: 'google_ads', name: 'Google Ads', category: 'ads', available_modes: ['sandbox'], metrics_count: 1, featured_metrics: [] },
      ],
    });
    await tick();
    await fixture.whenStable();
  }

  afterEach(() => backend.verify());

  it('lista os indicadores com a fórmula em chips legíveis e as plataformas', async () => {
    await setup();

    const card = el.querySelector('.metric')!;
    expect(card.querySelector('h3')?.textContent).toContain('ROAS combinado');
    const chips = [...card.querySelectorAll('app-formula-chips .chip')].map((c) => c.textContent?.trim());
    expect(chips).toContain('Investimento'); // meta_ads:spend → rótulo do catálogo
    expect(chips).toContain('sum');
    expect(card.querySelector('app-formula-chips .op')?.textContent).toBe('÷');
    expect([...card.querySelectorAll('.tag.provider')].map((t) => t.textContent?.trim())).toEqual(['Meta Ads', 'Google Ads']);
  });

  it('mostra a mensagem do backend quando o indicador está em uso', async () => {
    await setup();

    [...el.querySelectorAll<HTMLButtonElement>('.metric button')].find((b) => b.textContent?.includes('Excluir'))!.click();
    await fixture.whenStable();
    const confirm = [...el.querySelectorAll<HTMLButtonElement>('.metric button')].filter((b) =>
      b.textContent?.includes('Excluir'),
    );
    expect(el.textContent).toContain('Excluir “ROAS combinado”?');
    confirm.at(-1)!.click();
    await tick();

    const req = backend.expectOne((r) => r.method === 'DELETE' && r.url === '/api/custom-metrics/cm1');
    req.flush(
      { message: 'Em uso', errors: { id: ['Usado por: Margem de contribuição.'] } },
      { status: 422, statusText: 'Unprocessable Content' },
    );
    await tick();
    await fixture.whenStable();

    expect(el.querySelector('.delete-error')?.textContent).toContain('Usado por: Margem de contribuição.');
    expect(el.querySelectorAll('.metric').length).toBe(1);
  });

  it('abre o editor a partir de um modelo', async () => {
    await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    el.querySelector<HTMLButtonElement>('.template')!.click();

    expect(navigate).toHaveBeenCalledWith(['/indicadores/novo'], {
      queryParams: { modelo: 'Investimento total em mídia' },
    });
  });

  it('papel cliente vê a lista, sem criar, editar, excluir nem modelos', async () => {
    await setup('client');

    expect(el.querySelector('.metric h3')?.textContent).toContain('ROAS combinado');
    expect(el.textContent).toContain('Somente leitura');
    expect(el.querySelector('.metric .actions')).toBeNull();
    expect(el.querySelector('.template')).toBeNull();
  });
});
