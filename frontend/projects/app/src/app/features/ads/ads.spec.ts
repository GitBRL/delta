import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdCampaign, AdChange, Me, Role } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import {
  canActivate,
  canPause,
  changePct,
  changePctText,
  changeSummary,
  costPerResult,
  idempotencyKey,
  largeChangeMessage,
  moneyText,
  objectiveText,
  parseMoney,
  statusText,
  statusTone,
} from './ads';
import { AdsPage } from './ads.page';

const me = (role: Role): Me => ({
  id: 'u1',
  name: 'Ana',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const ACCOUNT = { id: 'a1', name: 'Conta de anúncios (demonstração)', currency: 'BRL', mode: 'sandbox' as const, status: 'active', projects: [{ id: 'p1', name: 'Padaria Aurora' }] };

const CAMPAIGNS: AdCampaign[] = [
  {
    id: '120200000000010', name: 'Conversões · Público quente', status: 'ACTIVE', objective: 'OUTCOME_SALES',
    daily_budget: 150, lifetime_budget: null, spend_7d: 980.5, results_7d: 21,
    adsets: [{ id: '120200000000011', name: 'Interesses amplos', status: 'ACTIVE', daily_budget: null, lifetime_budget: null, spend_7d: 980.5 }],
  },
  {
    id: '120200000000020', name: 'Tráfego · Lookalike 1%', status: 'PAUSED', objective: 'OUTCOME_TRAFFIC',
    daily_budget: null, lifetime_budget: null, spend_7d: 0, results_7d: 0,
    adsets: [{ id: '120200000000021', name: 'Lookalike 1%', status: 'ACTIVE', daily_budget: 60, lifetime_budget: null, spend_7d: 0 }],
  },
  { id: '120200000000030', name: 'Reconhecimento · Região', status: 'ACTIVE', objective: 'OUTCOME_AWARENESS', daily_budget: null, lifetime_budget: 3000, spend_7d: 210, results_7d: 0, adsets: [] },
];

const CHANGE: AdChange = {
  id: 'ch1', level: 'campaign', object_id: '120200000000010', object_name: 'Conversões · Público quente', action: 'budget',
  before: { daily_budget: 150 }, after: { daily_budget: 195 }, status: 'applied', error: null, created_at: '2026-11-12T10:00:00Z', created_by: 'Ana',
};

const drain = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('helpers de anúncios', () => {
  it('traduz status, objetivo e o que dá para fazer', () => {
    expect([statusText('ACTIVE'), statusText('PAUSED'), statusText('CAMPAIGN_PAUSED'), statusText('SOMETHING_NEW')]).toEqual(['Ativa', 'Pausada', 'Campanha pausada', 'something new']);
    expect([statusTone('ACTIVE'), statusTone('ADSET_PAUSED'), statusTone('WITH_ISSUES'), statusTone('IN_PROCESS')]).toEqual(['active', 'paused', 'issue', 'other']);
    expect([canPause('ACTIVE'), canPause('PAUSED'), canActivate('PAUSED'), canActivate('CAMPAIGN_PAUSED')]).toEqual([true, false, true, false]);
    expect([objectiveText('OUTCOME_SALES'), objectiveText(null)]).toEqual(['Vendas', '—']);
  });

  it('dinheiro, variação, custo por resultado e chave de idempotência', () => {
    expect(moneyText(150).replace(/\s/g, ' ')).toBe('R$ 150,00');
    expect(moneyText(null)).toBe('—');
    expect(parseMoney('1.234,50')).toBe(1234.5);
    expect(parseMoney('195.5')).toBe(195.5);
    expect(parseMoney('abc')).toBeNull();
    expect(changePctText(changePct(150, 195))).toBe('+30%');
    expect(changePctText(changePct(150, 60))).toBe('-60%');
    expect(costPerResult(980.5, 21)).toBeCloseTo(46.69, 2);
    expect(costPerResult(100, 0)).toBeNull();
    const key = idempotencyKey();
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(80);
    expect(/^[A-Za-z0-9_-]+$/.test(key)).toBe(true);
    expect(changeSummary(CHANGE).replace(/\s/g, ' ')).toBe('Orçamento diário R$ 150,00 → R$ 195,00');
    expect(changeSummary({ ...CHANGE, action: 'pause' })).toBe('Pausou');
    const large = new HttpErrorResponse({ status: 422, error: { errors: { daily_budget: ['Mudança de 80% no orçamento. Saltos acima de 50%...'] } } });
    expect(largeChangeMessage(large)).toContain('Mudança de 80%');
    expect(largeChangeMessage(new HttpErrorResponse({ status: 422, error: { errors: { daily_budget: ['Mínimo 1,00.'] } } }))).toBeNull();
  });
});

describe('AdsPage', () => {
  let fixture: ComponentFixture<AdsPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  const tick = async () => {
    await drain();
    TestBed.tick();
    await drain();
    TestBed.tick();
  };
  const row = (id: string) => el.querySelector<HTMLElement>(`tr[data-id="${id}"]`)!;
  const button = (text: string, root: ParentNode = el) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);

  async function reloadAfterChange(campaigns = CAMPAIGNS, history: AdChange[] = []): Promise<void> {
    backend.expectOne('/api/ads/accounts/a1/campaigns').flush({ data: campaigns, meta: { currency: 'BRL', mode: 'sandbox', large_change_pct: 50 } });
    backend.expectOne((r) => r.url === '/api/ads/changes').flush({ data: history });
    await tick();
  }

  async function mount(role: Role = 'analyst'): Promise<void> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } }],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdsPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    if (role === 'client') return;
    backend.expectOne('/api/ads/accounts').flush({ data: [ACCOUNT] });
    await tick();
    await reloadAfterChange(CAMPAIGNS, [CHANGE]);
  }

  afterEach(() => backend.verify());

  it('mostra campanhas, orçamentos, conjuntos e o histórico', async () => {
    await mount();
    expect(el.querySelector('[data-testid="ads-sandbox"]')?.textContent).toContain('Conta de demonstração');

    const first = row('120200000000010');
    expect(first.textContent).toContain('Ativa');
    expect(first.textContent).toContain('Vendas');
    expect(first.textContent?.replace(/\s/g, ' ')).toContain('R$ 150,00/dia');
    expect(first.textContent).toContain('21');
    expect(row('120200000000020').textContent).toContain('Orçamento nos conjuntos');
    expect(row('120200000000030').textContent?.replace(/\s/g, ' ')).toContain('Total: R$ 3.000,00');
    expect(button('Orçamento', row('120200000000030'))).toBeUndefined(); // orçamento total não é editado

    row('120200000000020').querySelector<HTMLButtonElement>('.expand')!.click();
    await tick();
    expect(row('120200000000021').textContent).toContain('Lookalike 1%');
    expect(row('120200000000021').textContent?.replace(/\s/g, ' ')).toContain('R$ 60,00/dia');

    const history = el.querySelector('[data-testid="ads-history"]')!;
    expect(history.textContent?.replace(/\s/g, ' ')).toContain('Campanha Conversões · Público quente: Orçamento diário R$ 150,00 → R$ 195,00');
    expect(history.textContent).toContain('Ana');
  });

  it('pausa com confirmação e manda a chave de idempotência', async () => {
    await mount();
    button('Pausar', row('120200000000010'))!.click();
    await tick();
    expect(row('120200000000010').textContent).toContain('Pausar?');
    button('Sim', row('120200000000010'))!.click();
    await tick();

    const req = backend.expectOne('/api/ads/accounts/a1/changes');
    expect(req.request.body).toEqual({ level: 'campaign', object_id: '120200000000010', action: 'pause', project_id: 'p1' });
    expect(req.request.headers.get('Idempotency-Key')).toMatch(/^delta-[A-Za-z0-9_-]{6,}$/);
    req.flush({ data: { ...CHANGE, action: 'pause', before: { status: 'ACTIVE' }, after: { status: 'PAUSED' } } }, { status: 201, statusText: 'Created' });
    await tick();
    await reloadAfterChange([{ ...CAMPAIGNS[0], status: 'PAUSED' }, ...CAMPAIGNS.slice(1)]);
    expect(row('120200000000010').textContent).toContain('Pausada');
    expect(button('Ativar', row('120200000000010'))).toBeDefined();
  });

  it('orçamento acima de 50% pede confirmação e reenvia com a mesma chave', async () => {
    await mount();
    button('Orçamento', row('120200000000010'))!.click();
    await tick();
    const dialog = () => el.querySelector<HTMLElement>('[data-testid="budget-dialog"]')!;
    expect(dialog().textContent?.replace(/\s/g, ' ')).toContain('Atual: R$ 150,00/dia');

    const input = dialog().querySelector<HTMLInputElement>('input[name="daily_budget"]')!;
    input.value = '300';
    input.dispatchEvent(new Event('input'));
    await tick();
    expect(dialog().querySelector('[data-testid="budget-variation"]')?.textContent).toContain('+100%');

    button('Aplicar', dialog())!.click();
    await tick();
    const first: TestRequest = backend.expectOne('/api/ads/accounts/a1/changes');
    expect(first.request.body).toMatchObject({ action: 'budget', daily_budget: 300 });
    expect(first.request.body.confirm_large_change).toBeUndefined();
    const key = first.request.headers.get('Idempotency-Key');
    first.flush({ message: 'x', errors: { daily_budget: ['Mudança de 100% no orçamento. Saltos acima de 50% costumam reiniciar o aprendizado da Meta; confirme para aplicar mesmo assim.'] } }, { status: 422, statusText: 'Unprocessable' });
    await tick();
    backend.expectOne((r) => r.url === '/api/ads/changes').flush({ data: [] });
    await tick();
    expect(dialog().querySelector('[data-testid="budget-confirm"]')?.textContent).toContain('Mudança de 100%');

    button('Aplicar mesmo assim', dialog())!.click();
    await tick();
    const second = backend.expectOne('/api/ads/accounts/a1/changes');
    expect(second.request.body).toMatchObject({ daily_budget: 300, confirm_large_change: true });
    expect(second.request.headers.get('Idempotency-Key')).toBe(key);
    second.flush({ data: { ...CHANGE, after: { daily_budget: 300 } } }, { status: 201, statusText: 'Created' });
    await tick();
    await reloadAfterChange();
    expect(el.querySelector('[data-testid="budget-dialog"]')).toBeNull();
  });

  it('cliente não vê a gestão de anúncios', async () => {
    await mount('client');
    backend.expectNone('/api/ads/accounts');
    expect(el.textContent).toContain('A gestão de anúncios é da equipe da agência.');
  });
});
