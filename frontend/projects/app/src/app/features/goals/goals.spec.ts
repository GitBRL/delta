import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Goal, GoalProgress, Me } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { goalBar, goalText, groupGoals, parseTarget } from './goals';
import { GoalsPage } from './goals.page';
import { ProjectGoalList } from './project-goal-list';

const ME: Me = {
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role: 'owner' }],
};

const progress = (over: Partial<GoalProgress> = {}): GoalProgress => ({
  goal_id: 'g1',
  period: { key: '2026-11', label: 'novembro de 2026', start: '2026-11-01', end: '2026-11-30', closed: false },
  value: 31,
  target: 100,
  expected: 33.33,
  projection: 93,
  progress_pct: 31,
  cumulative: true,
  days: { elapsed: 10, total: 30 },
  status: 'at_risk',
  label: 'Leads',
  unit: 'count',
  decimals: 0,
  ...over,
});

export const goal = (over: Partial<Goal> = {}, p: Partial<GoalProgress> = {}): Goal => ({
  id: 'g1',
  project: { id: 'p1', name: 'Padaria Aurora' },
  metric_key: 'manual:leads',
  comparison: 'at_least',
  target: 100,
  period: 'month',
  active: true,
  progress: progress(p),
  ...over,
});

const CPA = goal(
  { id: 'g2', metric_key: 'meta_ads:cpa', comparison: 'at_most', target: 50, project: { id: 'p2', name: 'Loja Vértice' } },
  { goal_id: 'g2', value: 60, target: 50, expected: 50, projection: 60, cumulative: false, status: 'off_track', label: 'Custo por conversão', unit: 'currency', decimals: 2 },
);

describe('helpers de metas', () => {
  it('texto claro para metas que acumulam e de nível', () => {
    expect(goalText(goal())).toBe('Leads: 31 de 100 · projeção 93 · novembro de 2026');
    expect(goalText(CPA).replace(/\u00a0/g, ' ')).toBe('Custo por conversão: R$ 60,00 (meta: no máximo R$ 50,00) · novembro de 2026');
    expect(goalText(goal({}, { status: 'achieved', value: 120 }))).toBe('Leads: 120 de 100 · novembro de 2026');
  });

  it('barra: ritmo esperado nas que acumulam; meta nas de nível; estouro no "no máximo"', () => {
    const bar = goalBar(progress(), 'at_least');
    expect(bar.fill).toBeCloseTo(0.31);
    expect(bar.marker).toBeCloseTo(0.3333);
    expect(bar.markerLabel).toBe('ritmo esperado até hoje');

    const level = goalBar(CPA.progress, 'at_most');
    expect(level.marker).toBeCloseTo(50 / 69);
    expect(level.markerLabel).toBe('meta');
    expect(level.over).toBe(true);

    expect(goalBar(progress({ period: { ...progress().period, closed: true } }), 'at_least').marker).toBeNull();
  });

  it('agrupa do que pede ação ao que foi batido e lê o alvo em pt-BR', () => {
    const groups = groupGoals([goal({ id: 'a' }, { status: 'achieved' }), CPA, goal({ id: 'b' }, { status: 'no_data', value: null })]);
    expect(groups.map((g) => g.label)).toEqual(['Fora do ritmo', 'Sem dados', 'Batidas']);
    expect(parseTarget('1.234,5')).toBe(1234.5);
    expect(parseTarget('R$ 50')).toBe(50);
    expect(parseTarget('0')).toBeNull();
    expect(parseTarget('abc')).toBeNull();
  });
});

describe('GoalsPage (/metas)', () => {
  let fixture: ComponentFixture<GoalsPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(ME), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(GoalsPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
  });

  afterEach(() => backend.verify());

  it('agrupa por estado com barra, marcador, projeto e filtro', async () => {
    backend.expectOne('/api/goals').flush({ data: [CPA, goal()] });
    await tick();

    const headings = [...el.querySelectorAll('section.group h2')].map((h) => h.textContent?.trim());
    expect(headings).toEqual(['Fora do ritmo', 'Em risco']);
    const card = el.querySelector('article[data-status="at_risk"]')!;
    expect(card.textContent).toContain('Padaria Aurora');
    expect(card.textContent).toContain('Leads: 31 de 100 · projeção 93');
    expect(card.querySelector('.marker')).not.toBeNull();
    expect(card.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('31');
    expect(el.querySelector('article[data-status="off_track"] ds-status-badge')).not.toBeNull();

    const select = el.querySelector<HTMLSelectElement>('select[name="goal_project"]')!;
    select.value = 'p2';
    select.dispatchEvent(new Event('change'));
    await tick();
    expect(el.querySelectorAll('app-goal-card')).toHaveLength(1);
    expect(el.textContent).toContain('Loja Vértice');
  });

  it('estado vazio aponta para os projetos', async () => {
    backend.expectOne('/api/goals').flush({ data: [] });
    await tick();
    expect(el.textContent).toContain('Nenhuma meta ainda');
  });
});

describe('ProjectGoalList', () => {
  let fixture: ComponentFixture<ProjectGoalList>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }
  const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(ME), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectGoalList);
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.componentRef.setInput('canEdit', true);
    fixture.componentRef.setInput('linkedProviders', ['meta_ads']);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    backend.expectOne('/api/projects/p1/goals').flush({ data: [goal()] });
    await tick();
  });

  afterEach(() => backend.verify());

  async function openForm(): Promise<void> {
    button('Nova meta').click();
    await tick();
    backend.expectOne('/api/metrics/catalog').flush({
      data: [
        { key: 'meta_ads:cpa', provider: 'meta_ads', label: 'CPA', description: '', unit: 'currency', kind: 'derived', direction: 'lower_is_better', decimals: 2, featured: true },
        { key: 'meta_ads:leads', provider: 'meta_ads', label: 'Leads', description: '', unit: 'count', kind: 'additive', direction: 'higher_is_better', decimals: 0, featured: false },
      ],
    });
    backend.expectOne('/api/providers').flush({
      data: [{ key: 'meta_ads', name: 'Meta Ads', category: 'ads', available_modes: ['sandbox'], metrics_count: 2, featured_metrics: [] }],
    });
    backend.expectOne('/api/custom-metrics').flush({ data: [] });
    backend.expectOne('/api/manual-metrics').flush({
      data: [{ id: 'mm1', key: 'manual:vendas_na_loja', name: 'Vendas na loja', description: null, unit: 'currency', direction: 'higher_is_better', decimals: 2, aggregation: 'sum', created_at: '' }],
    });
    await tick();
  }

  it('cria meta: sugere "no máximo" para CPA, mostra a unidade e envia o alvo em número', async () => {
    await openForm();
    const groups = [...el.querySelectorAll('optgroup')].map((g) => g.getAttribute('label'));
    expect(groups).toContain('Meta Ads');
    expect(groups).toContain('Dados manuais');

    const metric = el.querySelector<HTMLSelectElement>('select[name="goal_metric"]')!;
    metric.value = 'meta_ads:cpa';
    metric.dispatchEvent(new Event('change'));
    await tick();
    expect(el.querySelector<HTMLInputElement>('input[value="at_most"]')!.checked).toBe(true);
    expect(el.textContent).toContain('Alvo (R$)');

    const target = el.querySelector<HTMLInputElement>('input[name="goal_target"]')!;
    target.value = '49,90';
    target.dispatchEvent(new Event('input'));
    button('Criar meta').click();
    await tick();

    const post = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/projects/p1/goals');
    expect(post.request.body).toEqual({ metric_key: 'meta_ads:cpa', comparison: 'at_most', target: 49.9, period: 'month' });
    post.flush({ data: CPA }, { status: 201, statusText: 'Created' });
    await tick();
    backend.expectOne('/api/projects/p1/goals').flush({ data: [goal(), CPA] });
    await tick();
    expect(el.querySelectorAll('app-goal-card')).toHaveLength(2);
  });

  it('valida no navegador e mostra o 422 do servidor no campo', async () => {
    await openForm();
    button('Criar meta').click();
    await tick();
    expect(el.textContent).toContain('Escolha a métrica.');
    expect(el.textContent).toContain('Informe um alvo maior que zero.');

    const metric = el.querySelector<HTMLSelectElement>('select[name="goal_metric"]')!;
    metric.value = 'manual:vendas_na_loja';
    metric.dispatchEvent(new Event('change'));
    const target = el.querySelector<HTMLInputElement>('input[name="goal_target"]')!;
    target.value = '5000';
    target.dispatchEvent(new Event('input'));
    button('Criar meta').click();
    await tick();
    backend
      .expectOne((r) => r.method === 'POST')
      .flush({ message: 'x', errors: { metric_key: ['Métrica desconhecida.'] } }, { status: 422, statusText: 'Unprocessable' });
    await tick();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Métrica desconhecida.');
  });

  it('remove com confirmação', async () => {
    button('Remover').click();
    await tick();
    expect(el.textContent).toContain('Remover esta meta?');
    button('Remover').click();
    await tick();
    backend.expectOne((r) => r.method === 'DELETE' && r.url === '/api/goals/g1').flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    backend.expectOne('/api/projects/p1/goals').flush({ data: [] });
    await tick();
    expect(el.textContent).toContain('Nenhuma meta para este projeto.');
  });
});
