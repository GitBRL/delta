import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Me, Overview } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { hasAnyHealth, healthLegend, kpiTrend } from './overview';
import { OverviewPage } from './overview.page';

const ME: Me = {
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role: 'owner' }],
};

const OVERVIEW: Overview = {
  period: { start: '2026-10-13', end: '2026-11-11', label: '13/10/2026 – 11/11/2026' },
  compare: 'previous_period',
  generated_at: new Date().toISOString(),
  kpis: [
    { key: 'spend', label: 'Investimento em mídia', unit: 'currency', direction: 'neutral', decimals: 2, value: 44802.21, previous: 44100, change_pct: 1.6, sentiment: 'neutral' },
    { key: 'conversions', label: 'Conversões', unit: 'count', direction: 'higher_is_better', decimals: 0, value: 974, previous: 963, change_pct: 1.1, sentiment: 'positive' },
    { key: 'cpa', label: 'Custo por conversão', unit: 'currency', direction: 'lower_is_better', decimals: 2, value: 46, previous: 45.8, change_pct: 0.5, sentiment: 'neutral' },
    { key: 'roas', label: 'ROAS combinado', unit: 'decimal', direction: 'higher_is_better', decimals: 2, value: 2.92, previous: 2.97, change_pct: -1.6, sentiment: 'negative' },
  ],
  health: { acquisition: 100, engagement: null, conversion: 82 },
  radar: [
    {
      rule: 'meta_ads.roas_below_breakeven', metric: 'meta_ads:roas', status: 'critical', title: 'Campanhas dando prejuízo',
      explanation: 'ROAS 2,1 abaixo do equilíbrio 2,86.', suggestion: 'Pause os conjuntos com pior ROAS.', evidence: {},
      project_id: 'p1', project: 'Padaria Aurora',
    },
  ],
  projects: [
    { id: 'p1', name: 'Padaria Aurora', niche: 'restaurante_delivery', status: 'critical', summary: { critical: 1, attention: 0, opportunity: 0 }, headline: 'Campanhas dando prejuízo', detail: 'Pause os conjuntos com pior ROAS.', providers: ['meta_ads', 'instagram'], spend: 11057.13, health: 54 },
    { id: 'p2', name: 'Sem contas', niche: null, status: 'no_data', summary: { critical: 0, attention: 0, opportunity: 0 }, headline: 'Nenhuma conta conectada ao projeto', detail: 'Conecte as contas em Integrações e vincule ao projeto.', providers: [], spend: null },
  ],
  counts: { projects: 2, with_data: 1, critical: 1, attention: 0, opportunity: 0 },
};

describe('helpers da visão geral', () => {
  it('converte a variação para fração e some sem comparação', () => {
    expect(kpiTrend(OVERVIEW.kpis[0], 'previous_period')).toBeCloseTo(0.016);
    expect(kpiTrend(OVERVIEW.kpis[0], 'none')).toBeNull();
  });

  it('mantém "sem dados" nos anéis (nunca vira zero)', () => {
    expect(healthLegend(OVERVIEW.health).map((i) => i.value)).toEqual([100, null, 82]);
    expect(hasAnyHealth({ acquisition: null, engagement: null, conversion: null })).toBe(false);
  });
});

describe('OverviewPage', () => {
  let fixture: ComponentFixture<OverviewPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }
  async function settle(): Promise<void> {
    await tick();
    await fixture.whenStable();
  }

  beforeEach(async () => {
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
    fixture = TestBed.createComponent(OverviewPage);
    el = fixture.nativeElement as HTMLElement;
    await tick(); // a busca fica pendente até cada teste responder
  });

  afterEach(() => backend.verify());

  const request = () =>
    backend.expectOne((r) => r.url === '/api/overview');

  it('mostra KPIs, saúde, radar e projetos da API (sem dados fictícios)', async () => {
    const req = request();
    expect(req.request.params.get('period_preset')).toBe('last_30');
    expect(req.request.params.get('compare')).toBe('previous_period');
    expect(req.request.params.has('refresh')).toBe(false);
    req.flush({ data: OVERVIEW });
    await settle();

    expect(el.textContent).not.toContain('Dados de demonstração');
    expect(el.querySelectorAll('ds-kpi-tile')).toHaveLength(4);
    expect(el.textContent).toContain('ROAS combinado');
    expect(el.querySelector('[data-ring="engagement"]')?.textContent).toContain('sem dados');
    expect(el.querySelector('[data-ring="conversion"]')?.textContent).toContain('82');

    const radarLink = el.querySelector<HTMLAnchorElement>('a.radar-item');
    expect(radarLink?.getAttribute('href')).toBe('/projetos/p1');
    expect(radarLink?.textContent).toContain('Campanhas dando prejuízo');

    const cards = el.querySelectorAll<HTMLElement>('a.project');
    expect(cards).toHaveLength(2);
    expect(cards[1].dataset['status']).toBe('no_data');
    expect(cards[1].textContent).toContain('Sem dados');
    const health = cards[0].querySelector<HTMLElement>('.health');
    expect(health?.textContent).toContain('54');
    expect(health?.dataset['level']).toBe('poor');
    expect(health?.getAttribute('aria-label')).toBe('Saúde da conta 54 de 100');
    expect(cards[1].querySelector('.health')).toBeNull();
    expect(el.textContent).toContain('1 projeto está sem contas conectadas');
  });

  it('convida a criar o primeiro projeto quando a agência não tem nenhum', async () => {
    request().flush({ data: { ...OVERVIEW, kpis: [], radar: [], projects: [], counts: { projects: 0, with_data: 0, critical: 0, attention: 0, opportunity: 0 } } });
    await settle();

    expect(el.textContent).toContain('Comece pelo primeiro projeto');
    expect(el.querySelector('a[href="/projetos"]')).not.toBeNull();
    expect(el.querySelectorAll('ds-kpi-tile')).toHaveLength(0);
  });

  it('troca o período e o "Atualizar" ignora o cache do servidor', async () => {
    request().flush({ data: OVERVIEW });
    await settle();

    const select = el.querySelector<HTMLSelectElement>('select[aria-label="Período"]')!;
    select.value = 'last_7';
    select.dispatchEvent(new Event('change'));
    await tick();
    const byPeriod = request();
    expect(byPeriod.request.params.get('period_preset')).toBe('last_7');
    expect(byPeriod.request.params.has('refresh')).toBe(false);
    byPeriod.flush({ data: OVERVIEW });
    await settle();

    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Atualizar'))!.click();
    await tick();
    const refreshed = request();
    expect(refreshed.request.params.get('refresh')).toBe('1');
    refreshed.flush({ data: OVERVIEW });
    await settle();
  });
});
