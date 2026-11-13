import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Account, AttentionResult, Connection, CustomMetric, Me, MetricResult, ProjectHealth, Provider, TimelineEvent } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { resolvePreset } from '../../core/metrics/period';
import { LinkedAccounts } from './linked-accounts';
import { PeriodPicker } from './period-picker';
import { ProjectDetailPage } from './project-detail.page';

const ME: Me = {
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role: 'owner' }],
};

const ACCOUNT: Account = {
  id: 'a1',
  provider: 'meta_ads',
  name: 'Padaria Aurora',
  kind: 'ad_account',
  currency: 'BRL',
  external_id: 'act_1',
};

const CONNECTION: Connection = {
  id: 'c1',
  provider: 'meta_ads',
  mode: 'sandbox',
  status: 'active',
  label: 'Demonstração',
  last_synced_at: '2026-11-12T10:00:00Z',
  last_error: null,
  accounts: [ACCOUNT, { ...ACCOUNT, id: 'a2', name: 'Loja Boreal', external_id: 'act_2' }],
};

const PROVIDERS: Provider[] = [
  {
    key: 'meta_ads',
    name: 'Meta Ads',
    category: 'ads',
    available_modes: ['sandbox'],
    metrics_count: 16,
    featured_metrics: ['meta_ads:spend', 'meta_ads:cpa'],
  },
  {
    key: 'ga4',
    name: 'Google Analytics 4',
    category: 'analytics',
    available_modes: ['sandbox'],
    metrics_count: 12,
    featured_metrics: ['ga4:sessions'],
  },
];

const metric = (key: string, label: string, extra: Partial<MetricResult> = {}): MetricResult => ({
  key,
  label,
  unit: 'currency',
  direction: 'higher_is_better',
  decimals: 2,
  value: 1240,
  previous: 1148,
  change_pct: 8,
  sentiment: 'positive',
  approximate: false,
  series: [
    { date: '2026-11-10', value: 600 },
    { date: '2026-11-11', value: 640 },
  ],
  previous_series: [
    { date: '2026-11-08', value: 560 },
    { date: '2026-11-09', value: 588 },
  ],
  ...extra,
});

const customMetric = (key: string, name: string, providers: string[]): CustomMetric => ({
  id: key,
  key,
  name,
  description: null,
  formula: '1',
  unit: 'decimal',
  direction: 'higher_is_better',
  decimals: 2,
  providers,
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:00:00Z',
});

const EMPTY_ATTENTION: AttentionResult = {
  period: resolvePreset('last_30')!,
  summary: { critical: 0, attention: 0, opportunity: 0 },
  statuses: {},
  signals: [],
};

const ATTENTION: AttentionResult = {
  period: resolvePreset('last_30')!,
  summary: { critical: 1, attention: 1, opportunity: 0 },
  statuses: { 'meta_ads:spend': 'healthy', 'meta_ads:cpa': 'critical', 'meta_ads:frequency': 'attention' },
  signals: [
    {
      rule: 'meta_ads.cpa_high',
      metric: 'meta_ads:cpa',
      status: 'critical',
      title: 'Custo por conversão acima da meta',
      explanation: 'CPA de R$ 80,00 contra a meta de R$ 50,00.',
      suggestion: 'Mova verba para as campanhas com CPA abaixo da meta.',
      evidence: { value: 80, target: 50 },
    },
    {
      rule: 'meta_ads.frequency_high',
      metric: 'meta_ads:frequency',
      status: 'attention',
      title: 'Público saturando',
      explanation: 'Frequência de 3,4 nos últimos 7 dias.',
      suggestion: 'Renove os criativos.',
      evidence: { value: 3.4 },
    },
  ],
};

const HEALTH: ProjectHealth = {
  score: 72,
  level: 'fair',
  factors: [{ label: '1 alerta(s) crítico(s)', impact: -20 }, { label: '1 meta(s) em risco', impact: -5 }],
  summary: { critical: 1, attention: 0, opportunity: 0 },
  history: [],
};

/** Indicadores da agência devolvidos por GET /api/custom-metrics (padrão: nenhum). */
let customMetrics: CustomMetric[] = [];

/** Último dia com dados (fim de "últimos 30 dias"): o marco cai dentro do período do gráfico. */
const LAST_DAY = resolvePreset('last_30')!.end;
const TIMELINE: TimelineEvent[] = [
  { id: 'e1', type: 'manual', title: 'Campanha de Black Friday no ar', description: null, occurred_on: LAST_DAY, created_by: 'Ana', manual: true },
  { id: 'e2', type: 'report_published', title: 'Relatório publicado: Mensal', description: null, occurred_on: '2025-01-10', created_by: null, manual: false },
];

describe('ProjectDetailPage', () => {
  let fixture: ComponentFixture<ProjectDetailPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  /** Deixa respostas e continuações async (microtasks) acontecerem. */
  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  /** Roda efeitos e detecção de mudanças (dispara requisições); não espera requisições. */
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }
  /** Espera estabilizar. Só SEM requisições pendentes (elas contam como tarefa pendente do app). */
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
    fixture = TestBed.createComponent(ProjectDetailPage);
    fixture.componentRef.setInput('id', 'p1');
    el = fixture.nativeElement as HTMLElement;
    await tick();

    backend.expectOne('/api/projects/p1').flush({
      data: { id: 'p1', name: 'Padaria Aurora', niche: 'negocio_local', created_at: '2026-11-01T10:00:00Z' },
    });
    backend.expectOne('/api/projects/p1/accounts').flush({ data: [ACCOUNT] });
    backend.expectOne('/api/connections').flush({ data: [CONNECTION] });
    backend.expectOne('/api/providers').flush({ data: PROVIDERS });
    backend.expectOne('/api/custom-metrics').flush({ data: customMetrics });
    backend.expectOne('/api/projects/p1/snapshots').flush({ data: [] });
    backend.expectOne((r) => r.url === '/api/posts' && r.params.get('project_id') === 'p1').flush({ data: [] });
    backend.expectOne('/api/projects/p1/contacts').flush({ data: [] });
    backend.expectOne('/api/projects/p1/goals').flush({ data: [] });
    backend.expectOne('/api/projects/p1/timeline').flush({ data: TIMELINE });
    backend.expectOne('/api/manual-metrics').flush({ data: [] });
    backend.expectOne('/api/projects/p1/health?days=90').flush({ data: HEALTH });
    backend.expectOne('/api/projects/p1/actions').flush({ data: [] });
    backend.expectOne('/api/ai').flush({ data: { enabled: true, configured: false, source: null, budget: 2000000, used_this_month: 0 } });
    await tick(); // dispara a consulta de métricas, que cada teste responde
  });

  afterEach(() => {
    backend.verify();
    customMetrics = [];
  });

  /** Avaliação do radar pendente (pedida junto com a consulta de métricas). */
  const attentionReq = () => backend.expectOne('/api/projects/p1/attention');

  it('consulta as métricas em destaque dos canais vinculados nos últimos 30 dias', async () => {
    attentionReq().flush({ data: EMPTY_ATTENTION });
    const req = backend.expectOne('/api/projects/p1/metrics/query');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    expect(req.request.body).toEqual({
      ...resolvePreset('last_30'),
      compare: 'previous_period',
      metrics: ['meta_ads:spend', 'meta_ads:cpa'],
      series: true,
    });

    req.flush({
      data: {
        period: resolvePreset('last_30'),
        comparison: null,
        metrics: [
          metric('meta_ads:spend', 'Investimento'),
          metric('meta_ads:cpa', 'CPA', { direction: 'lower_is_better', approximate: true, value: null }),
        ],
      },
    });
    await settle();

    expect(el.querySelector('h1')?.textContent).toContain('Padaria Aurora');
    expect(el.textContent).toContain('Negócio local');
    const tiles = el.querySelectorAll('ds-kpi-tile');
    expect(tiles.length).toBe(2);
    expect(tiles[0].querySelector('.value')?.getAttribute('aria-label')?.replace(/\u00a0/g, ' ')).toBe(
      'Investimento: R$ 1.240,00',
    );
    expect(tiles[1].querySelector('.value')?.textContent).toContain('—');
    expect(el.querySelector('ds-area-chart')).not.toBeNull();
    expect(el.querySelector('.chart-card h3')?.textContent).toContain('Investimento');

    // clicar no segundo KPI troca o gráfico
    (el.querySelectorAll<HTMLElement>('.kpi')[1]).click();
    await settle();
    expect(el.querySelector('.chart-card h3')?.textContent).toContain('CPA');
    expect(el.querySelectorAll('.kpi')[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('refaz a consulta e o radar ao trocar período; a comparação só refaz a consulta', async () => {
    const first = attentionReq();
    expect(first.request.method).toBe('POST');
    expect(first.request.headers.get('X-Tenant-Id')).toBe('t1');
    expect(first.request.body).toEqual(resolvePreset('last_30'));
    first.flush({ data: EMPTY_ATTENTION });
    backend.expectOne('/api/projects/p1/metrics/query').flush({
      data: { period: resolvePreset('last_30'), comparison: null, metrics: [] },
    });
    await settle();

    const presets = [...el.querySelectorAll<HTMLButtonElement>('.preset')];
    presets.find((b) => b.textContent?.includes('Últimos 7 dias'))?.click();
    await tick();

    let req = backend.expectOne('/api/projects/p1/metrics/query');
    expect(req.request.body.start).toBe(resolvePreset('last_7')?.start);
    req.flush({ data: { period: resolvePreset('last_7'), comparison: null, metrics: [] } });
    const radar = attentionReq();
    expect(radar.request.body).toEqual(resolvePreset('last_7'));
    radar.flush({ data: { ...EMPTY_ATTENTION, period: resolvePreset('last_7')! } });
    await settle();

    const select = el.querySelector<HTMLSelectElement>('app-period-picker select')!;
    select.value = 'previous_year';
    select.dispatchEvent(new Event('change'));
    await tick();

    req = backend.expectOne('/api/projects/p1/metrics/query');
    expect(req.request.body.compare).toBe('previous_year');
    req.flush({ data: { period: resolvePreset('last_7'), comparison: null, metrics: [] } });
  });

  it('mostra a linha do tempo e desenha os marcos do período no gráfico', async () => {
    attentionReq().flush({ data: EMPTY_ATTENTION });
    backend.expectOne('/api/projects/p1/metrics/query').flush({
      data: {
        period: resolvePreset('last_30'),
        comparison: null,
        metrics: [metric('meta_ads:spend', 'Investimento', { series: [{ date: LAST_DAY, value: 10 }], previous_series: [] })],
      },
    });
    await settle();

    const timeline = el.querySelector('app-project-timeline')!;
    expect(timeline.textContent).toContain('Campanha de Black Friday no ar');
    expect(timeline.textContent).toContain('Relatório publicado');
    // Só o marco dentro do período vira linha no gráfico.
    expect(el.querySelectorAll('ds-area-chart line.marker')).toHaveLength(1);
    expect(el.textContent).toContain('marcos da linha do tempo');
  });

  it('salva as contas vinculadas com PUT e reavalia o radar', async () => {
    attentionReq().flush({ data: EMPTY_ATTENTION });
    backend.expectOne('/api/projects/p1/metrics/query').flush({
      data: { period: resolvePreset('last_30'), comparison: null, metrics: [] },
    });
    await settle();

    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Editar'))?.click();
    await settle();
    const boxes = el.querySelectorAll<HTMLInputElement>('app-linked-accounts input[type=checkbox]');
    expect(boxes.length).toBe(2);
    expect(boxes[0].checked).toBe(true);
    boxes[1].click();
    await settle();
    el.querySelector<HTMLFormElement>('app-linked-accounts form')!.dispatchEvent(new Event('submit'));
    await tick();

    const req = backend.expectOne((r) => r.method === 'PUT' && r.url === '/api/projects/p1/accounts');
    expect(req.request.body).toEqual({ account_ids: ['a1', 'a2'] });
    req.flush({ data: CONNECTION.accounts });
    await tick();

    // contas diferentes → o radar reavalia; mesmas métricas (mesmo canal) → nenhuma consulta nova
    attentionReq().flush({ data: EMPTY_ATTENTION });
    await settle();
    backend.expectNone('/api/projects/p1/metrics/query');
    expect(el.querySelectorAll('app-linked-accounts .chip').length).toBe(2);
  });

  it('mostra o radar, os selos nos KPIs e seleciona o KPI ao clicar no sinal', async () => {
    attentionReq().flush({ data: ATTENTION });
    backend.expectOne('/api/projects/p1/metrics/query').flush({
      data: {
        period: resolvePreset('last_30'),
        comparison: null,
        metrics: [metric('meta_ads:spend', 'Investimento'), metric('meta_ads:cpa', 'CPA', { direction: 'lower_is_better' })],
      },
    });
    await settle();

    const radar = el.querySelector('app-attention-radar')!;
    expect([...radar.querySelectorAll('.summary-chip')].map((c) => c.textContent?.trim())).toEqual([
      '1 crítico',
      '1 em atenção',
    ]);
    const cards = [...radar.querySelectorAll<HTMLElement>('article.signal')];
    expect(cards.map((c) => c.querySelector('h3')?.textContent?.trim())).toEqual([
      'Custo por conversão acima da meta',
      'Público saturando',
    ]);
    // frequência não está na grade de KPIs: o sinal não é clicável
    expect(cards[1].getAttribute('role')).toBeNull();

    const badges = [...el.querySelectorAll('.kpis ds-kpi-tile')].map((t) =>
      t.querySelector('ds-status-badge')?.getAttribute('data-status'),
    );
    expect(badges).toEqual(['healthy', 'critical']);

    expect(el.querySelector('.chart-card h3')?.textContent).toContain('Investimento');
    cards[0].click();
    await settle();
    expect(el.querySelector('.chart-card h3')?.textContent).toContain('CPA');
    expect(el.querySelectorAll('.kpi')[1].getAttribute('aria-pressed')).toBe('true');
    expect(cards[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('mostra a saúde da conta com fatores', async () => {
    attentionReq().flush({ data: EMPTY_ATTENTION });
    backend.expectOne('/api/projects/p1/metrics/query').flush({ data: { period: resolvePreset('last_30'), comparison: null, metrics: [] } });
    await settle();

    const card = el.querySelector('app-project-health')!;
    expect(card.querySelector('.score')?.textContent?.trim()).toBe('72');
    expect(card.querySelector('[data-testid="health-level"]')?.textContent?.trim()).toBe('Regular');
    expect(card.textContent).toContain('1 alerta(s) crítico(s)');
    expect(card.textContent).toContain('−20');
    expect(card.textContent).toContain('A tendência aparece depois de alguns dias');
  });

  it('sinal do nicho mostra a faixa e "Criar ação" abre o plano pré-preenchido', async () => {
    const bench: AttentionResult = {
      ...ATTENTION,
      signals: [
        {
          rule: 'benchmark.meta_ads:cpc',
          metric: 'meta_ads:cpc',
          status: 'attention',
          title: 'CPC (link) fora da faixa do nicho',
          explanation: 'CPC de R$ 1,88 no período, acima de R$ 1,60.',
          suggestion: 'Melhore a relevância do anúncio.',
          evidence: { value: 1.88, p25: 0.5, p50: 0.9, p75: 1.6 },
        },
      ],
    };
    attentionReq().flush({ data: bench });
    backend.expectOne('/api/projects/p1/metrics/query').flush({ data: { period: resolvePreset('last_30'), comparison: null, metrics: [] } });
    await settle();

    const signal = el.querySelector<HTMLElement>('app-attention-radar article.signal')!;
    expect(signal.querySelector('.source')?.textContent?.trim()).toBe('Referência do nicho');
    expect(signal.querySelector('.bench')?.getAttribute('aria-label')).toBe('Faixa do nicho: 0,5 a 1,6. Este período: 1,88');

    signal.querySelector<HTMLButtonElement>('.create-action')!.click();
    await tick();
    backend.expectOne('/api/staff-members').flush({ data: [{ id: 'u1', name: 'Ana Lima' }] });
    await tick();

    const form = el.querySelector('app-project-actions form')!;
    expect(form.querySelector<HTMLInputElement>('input[name="action_title"]')!.value).toBe('CPC (link) fora da faixa do nicho');
    expect(form.querySelector<HTMLTextAreaElement>('textarea[name="action_suggestion"]')!.value).toBe('Melhore a relevância do anúncio.');
    expect(form.querySelector('select[name="action_metric"]')).toBeNull(); // a métrica vem do sinal

    form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await tick();
    const req = backend.expectOne('/api/projects/p1/actions');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      title: 'CPC (link) fora da faixa do nicho',
      assignee_id: null,
      due_on: null,
      rule: 'benchmark.meta_ads:cpc',
      metric_key: 'meta_ads:cpc',
      suggestion: 'Melhore a relevância do anúncio.',
    });
    req.flush({
      data: {
        id: 'ac1', project: { id: 'p1', name: 'Padaria Aurora' }, rule: 'benchmark.meta_ads:cpc', metric_key: 'meta_ads:cpc',
        title: 'CPC (link) fora da faixa do nicho', suggestion: 'Melhore a relevância do anúncio.', status: 'open', assignee: null,
        due_on: null, dismissed_reason: null, applied_at: null, baseline: null, outcome: null, measured_at: null, feedback: null, created_at: '2026-11-12T10:00:00Z',
      },
    });
    await settle();
    expect(el.querySelector('app-project-actions form')).toBeNull();
    expect(el.querySelector('app-action-board [data-column="open"] [data-action="ac1"]')).not.toBeNull();
  });

  it('salva as metas com PATCH (nulos nos vazios) e reavalia o radar', async () => {
    attentionReq().flush({ data: EMPTY_ATTENTION });
    backend.expectOne('/api/projects/p1/metrics/query').flush({
      data: { period: resolvePreset('last_30'), comparison: null, metrics: [] },
    });
    await settle();

    const goals = el.querySelector('app-project-goals')!;
    expect(goals.textContent).toContain('Sem metas definidas.');
    [...goals.querySelectorAll('button')].find((b) => b.textContent?.includes('Editar'))!.click();
    await settle();

    const margin = goals.querySelector<HTMLInputElement>('input[name=gross_margin_pct]')!;
    margin.value = '40';
    margin.dispatchEvent(new Event('input'));
    goals.querySelector('form')!.dispatchEvent(new Event('submit'));
    await tick();

    const patch = backend.expectOne((r) => r.method === 'PATCH' && r.url === '/api/projects/p1');
    expect(patch.request.headers.get('X-Tenant-Id')).toBe('t1');
    expect(patch.request.body).toEqual({ goals: { gross_margin_pct: 40, target_cpa: null, target_roas: null } });
    patch.flush({
      data: {
        id: 'p1',
        name: 'Padaria Aurora',
        niche: 'negocio_local',
        goals: { gross_margin_pct: 40, target_cpa: null, target_roas: null },
        created_at: '2026-11-01T10:00:00Z',
      },
    });
    await tick();

    attentionReq().flush({ data: ATTENTION }); // metas mudam o que é problema → reavalia
    await settle();
    expect(goals.querySelector('form')).toBeNull();
    expect(goals.textContent).toContain('Com margem de 40%, ROAS abaixo de 2,50 é prejuízo.');
    expect(el.querySelectorAll('app-attention-radar article.signal').length).toBe(2);
  });

  it('mostra o erro 422 das metas no campo', async () => {
    attentionReq().flush({ data: EMPTY_ATTENTION });
    backend.expectOne('/api/projects/p1/metrics/query').flush({
      data: { period: resolvePreset('last_30'), comparison: null, metrics: [] },
    });
    await settle();

    const goals = el.querySelector('app-project-goals')!;
    [...goals.querySelectorAll('button')].find((b) => b.textContent?.includes('Editar'))!.click();
    await settle();
    const cpa = goals.querySelector<HTMLInputElement>('input[name=target_cpa]')!;
    cpa.value = '5000000';
    cpa.dispatchEvent(new Event('input'));
    goals.querySelector('form')!.dispatchEvent(new Event('submit'));
    await tick();

    backend
      .expectOne((r) => r.method === 'PATCH' && r.url === '/api/projects/p1')
      .flush(
        { message: 'O valor é alto demais.', errors: { 'goals.target_cpa': ['A meta de CPA é alta demais.'] } },
        { status: 422, statusText: 'Unprocessable Content' },
      );
    await settle();

    expect(goals.querySelector('form')).not.toBeNull(); // continua editando, sem perder o que digitou
    expect(goals.querySelector<HTMLInputElement>('input[name=target_cpa]')!.value).toBe('5000000');
    const fields = [...goals.querySelectorAll('ds-text-field')];
    expect(fields[1].querySelector('.error')?.textContent).toContain('A meta de CPA é alta demais.');
  });
});

describe('ProjectDetailPage com indicadores personalizados', () => {
  let backend: HttpTestingController;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));

  it('inclui só os indicadores das plataformas vinculadas e os mostra em seção própria', async () => {
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
    const fixture = TestBed.createComponent(ProjectDetailPage);
    fixture.componentRef.setInput('id', 'p1');
    const el = fixture.nativeElement as HTMLElement;
    await drain();
    TestBed.tick();

    backend.expectOne('/api/projects/p1').flush({
      data: { id: 'p1', name: 'Padaria Aurora', niche: null, created_at: '2026-11-01T10:00:00Z' },
    });
    backend.expectOne('/api/projects/p1/accounts').flush({ data: [ACCOUNT] }); // só meta_ads
    backend.expectOne('/api/connections').flush({ data: [CONNECTION] });
    backend.expectOne('/api/providers').flush({ data: PROVIDERS });
    backend.expectOne('/api/projects/p1/snapshots').flush({ data: [] });
    backend.expectOne((r) => r.url === '/api/posts' && r.params.get('project_id') === 'p1').flush({ data: [] });
    backend.expectOne('/api/projects/p1/contacts').flush({ data: [] });
    backend.expectOne('/api/projects/p1/goals').flush({ data: [] });
    backend.expectOne('/api/projects/p1/timeline').flush({ data: TIMELINE });
    backend.expectOne('/api/manual-metrics').flush({ data: [] });
    backend.expectOne('/api/projects/p1/health?days=90').flush({ data: HEALTH });
    backend.expectOne('/api/projects/p1/actions').flush({ data: [] });
    backend.expectOne('/api/ai').flush({ data: { enabled: true, configured: false, source: null, budget: 2000000, used_this_month: 0 } });
    backend.expectOne('/api/custom-metrics').flush({
      data: [
        customMetric('custom:roas_total', 'ROAS total', ['meta_ads', 'google_ads']),
        customMetric('custom:sessoes', 'Sessões ajustadas', ['ga4']),
        customMetric('custom:meta_fixa', 'Meta fixa', []),
      ],
    });
    await drain();
    TestBed.tick();

    backend.expectOne('/api/projects/p1/attention').flush({ data: EMPTY_ATTENTION });
    const req = backend.expectOne('/api/projects/p1/metrics/query');
    expect(req.request.body.metrics).toEqual(['meta_ads:spend', 'meta_ads:cpa', 'custom:roas_total', 'custom:meta_fixa']);
    req.flush({
      data: {
        period: resolvePreset('last_30'),
        comparison: null,
        metrics: [
          metric('meta_ads:spend', 'Investimento'),
          metric('meta_ads:cpa', 'CPA'),
          metric('custom:roas_total', 'ROAS total', { unit: 'decimal' }),
          metric('custom:meta_fixa', 'Meta fixa', { unit: 'decimal' }),
        ],
      },
    });
    await drain();
    TestBed.tick();
    await fixture.whenStable();

    const section = el.querySelector('section.custom')!;
    expect(section.querySelector('h3')?.textContent).toContain('Indicadores personalizados');
    expect([...section.querySelectorAll('ds-kpi-tile .label')].map((l) => l.textContent?.trim())).toEqual([
      'ROAS total',
      'Meta fixa',
    ]);
    expect(el.querySelectorAll('ds-kpi-tile').length).toBe(4);

    (section.querySelector<HTMLElement>('.kpi'))!.click();
    await fixture.whenStable();
    expect(el.querySelector('.chart-card h3')?.textContent).toContain('ROAS total');
    backend.verify();
  });
});

describe('PeriodPicker', () => {
  it('desabilita "Este mês" no dia 1 (ainda não há dia com dados)', async () => {
    const fixture = TestBed.createComponent(PeriodPicker);
    fixture.componentRef.setInput('today', new Date(2026, 10, 1));
    await fixture.whenStable();

    const thisMonth = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.preset')].find(
      (b) => b.textContent?.includes('Este mês'),
    );
    expect(thisMonth?.disabled).toBe(true);
  });

  it('limita as datas personalizadas a ontem', async () => {
    const fixture = TestBed.createComponent(PeriodPicker);
    fixture.componentRef.setInput('today', new Date(2026, 10, 12));
    fixture.componentInstance.preset.set('custom');
    await fixture.whenStable();

    const inputs = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('input[type=date]');
    expect(inputs.length).toBe(2);
    expect(inputs[1].max).toBe('2026-11-11');
  });
});

describe('LinkedAccounts', () => {
  it('sem conexões leva para Integrações', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(LinkedAccounts);
    fixture.componentRef.setInput('connections', []);
    fixture.componentRef.setInput('linked', []);
    await fixture.whenStable();

    const link = (fixture.nativeElement as HTMLElement).querySelector('a');
    expect(link?.getAttribute('href')).toBe('/integracoes');
  });
});
