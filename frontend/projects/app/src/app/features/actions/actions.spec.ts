import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Me, PlanAction } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { ActionBoard } from './action-board';
import { actionFromSignal, dueText, groupActions, measuringText, metricName, outcomeText } from './actions';
import { ActionsPage } from './actions.page';

const ME: Me = {
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role: 'owner' }],
};

const action = (over: Partial<PlanAction> = {}): PlanAction => ({
  id: 'a1',
  project: { id: 'p1', name: 'Padaria Aurora' },
  rule: 'meta_ads.cpa_high',
  metric_key: 'meta_ads:cpa',
  title: 'Mover verba para campanhas abaixo da meta',
  suggestion: 'Pause os conjuntos com CPA acima de R$ 80.',
  status: 'open',
  assignee: { id: 'u1', name: 'Ana Lima' },
  due_on: '2026-11-20',
  dismissed_reason: null,
  applied_at: null,
  baseline: null,
  outcome: null,
  measured_at: null,
  feedback: null,
  created_at: '2026-11-10T10:00:00Z',
  ...over,
});

describe('helpers do plano de ação', () => {
  it('agrupa por coluna e nomeia as métricas em pt-BR', () => {
    const groups = groupActions([action(), action({ id: 'a2', status: 'done' }), action({ id: 'a3', status: 'dismissed' })]);
    expect(groups.open.map((a) => a.id)).toEqual(['a1']);
    expect(groups.done).toHaveLength(1);
    expect(groups.doing).toHaveLength(0);
    expect(metricName('meta_ads:cpa')).toBe('CPA');
    expect(metricName('manual:vendas_na_loja')).toBe('Vendas na loja');
    expect(metricName('ga4:sessions')).toBe('Sessões');
    expect(metricName('x:y', { 'x:y': 'Rótulo' })).toBe('Rótulo');
  });

  it('mede: "resultado em X dias" e depois o resultado com sentido', () => {
    const applied = action({ status: 'done', applied_at: '2026-11-10T12:00:00Z', baseline: { value: 80, start: '2026-10-27', end: '2026-11-09' } });
    expect(measuringText(applied, new Date('2026-11-15T12:00:00Z'))).toBe('Medindo… resultado em 9 dias');
    expect(measuringText(applied, new Date('2026-11-24T12:00:00Z'))).toBe('Medindo… resultado em breve');

    const measured = { ...applied, outcome: { value: 65.6, start: '2026-11-10', end: '2026-11-23', change_pct: -18, improved: true } };
    expect(measuringText(measured)).toBeNull();
    expect(outcomeText(measured)).toBe('CPA caiu 18% depois desta ação');
    expect(outcomeText({ ...measured, outcome: { ...measured.outcome, change_pct: 12.5 } })).toBe('CPA subiu 12,5% depois desta ação');
  });

  it('prazo e pré-preenchimento a partir de um sinal', () => {
    expect(dueText('2026-11-20', new Date(2026, 10, 12))).toEqual({ text: expect.stringContaining('20'), late: false });
    expect(dueText('2026-11-01', new Date(2026, 10, 12))?.late).toBe(true);
    expect(
      actionFromSignal({ rule: 'r', metric: 'm:x', status: 'attention', title: 'T', explanation: 'E', suggestion: 'S', evidence: {} }),
    ).toEqual({ rule: 'r', metric_key: 'm:x', title: 'T', suggestion: 'S' });
  });
});

describe('ActionBoard', () => {
  let fixture: ComponentFixture<ActionBoard>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }
  const card = (id: string) => el.querySelector<HTMLElement>(`[data-action="${id}"]`)!;
  const btn = (root: Element, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ActionBoard);
    fixture.componentRef.setInput('actions', [
      action(),
      action({ id: 'a2', status: 'done', applied_at: new Date().toISOString(), title: 'Renovar criativos' }),
      action({ id: 'a3', status: 'done', title: 'Trocar oferta', outcome: { value: 10, start: '', end: '', change_pct: -18, improved: true }, feedback: 'useful' }),
    ]);
    fixture.componentRef.setInput('canEdit', true);
    el = fixture.nativeElement as HTMLElement;
    await tick();
  });

  afterEach(() => backend.verify());

  it('mostra as colunas, a medição e o resultado', () => {
    expect([...el.querySelectorAll('.col-title')].map((t) => t.textContent?.replace(/\d+/, '').trim())).toEqual([
      'A fazer',
      'Em andamento',
      'Aplicadas',
      'Descartadas',
    ]);
    expect(card('a2').querySelector('.measure')?.textContent).toContain('Medindo… resultado em');
    const outcome = card('a3').querySelector('.outcome')!;
    expect(outcome.textContent).toContain('CPA caiu 18% depois desta ação');
    expect(outcome.getAttribute('data-improved')).toBe('true');
    expect(btn(card('a3'), 'Sim').getAttribute('aria-pressed')).toBe('true');
  });

  it('descartar exige motivo e envia o PATCH com ele', async () => {
    const changed: PlanAction[] = [];
    fixture.componentInstance.changed.subscribe((a) => changed.push(a));

    btn(card('a1'), 'Descartar').click();
    await tick();
    btn(card('a1'), 'Descartar').click(); // envia sem motivo
    await tick();
    expect(card('a1').querySelector('.error')?.textContent).toContain('Conte por que');
    backend.expectNone('/api/actions/a1');

    const input = card('a1').querySelector<HTMLInputElement>('input[name="dismiss_reason"]')!;
    input.value = 'Cliente já está trocando o site';
    input.dispatchEvent(new Event('input'));
    btn(card('a1'), 'Descartar').click();
    await tick();
    const req = backend.expectOne('/api/actions/a1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'dismissed', dismissed_reason: 'Cliente já está trocando o site' });
    req.flush({ data: action({ status: 'dismissed', dismissed_reason: 'Cliente já está trocando o site' }) });
    await tick();
    expect(changed[0].status).toBe('dismissed');
  });

  it('move para aplicada e marca o feedback', async () => {
    btn(card('a1'), 'Aplicada').click();
    await tick();
    const done = backend.expectOne('/api/actions/a1');
    expect(done.request.body).toEqual({ status: 'done' });
    done.flush({ data: action({ status: 'done' }) });
    await tick();

    btn(card('a3'), 'Sim').click(); // desmarca
    await tick();
    expect(backend.expectOne('/api/actions/a3').request.body).toEqual({ feedback: null });
  });
});

describe('ActionsPage (/acoes)', () => {
  let fixture: ComponentFixture<ActionsPage>;
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
    fixture = TestBed.createComponent(ActionsPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
  });

  afterEach(() => backend.verify());

  it('quadro da agência com projeto em cada ação e filtro', async () => {
    backend.expectOne('/api/actions').flush({
      data: [action(), action({ id: 'a2', project: { id: 'p2', name: 'Loja Vértice' }, title: 'Revisar oferta' })],
    });
    await tick();

    expect([...el.querySelectorAll('.project')].map((p) => p.textContent?.trim())).toEqual(['Padaria Aurora', 'Loja Vértice']);
    const select = el.querySelector<HTMLSelectElement>('select[name="actions_project"]')!;
    select.value = 'p2';
    select.dispatchEvent(new Event('change'));
    await tick();
    expect(el.querySelectorAll('article.card')).toHaveLength(1);
    expect(el.textContent).toContain('Revisar oferta');
  });

  it('estado vazio orienta a usar o radar', async () => {
    backend.expectOne('/api/actions').flush({ data: [] });
    await tick();
    expect(el.textContent).toContain('Nenhuma ação ainda');
  });
});
