import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { Me, MetricDefinition, Provider, Role, SheetSync, SyncDestinationList } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { OAuthService } from '../../core/oauth/oauth.service';
import { emptySyncDraft, previewCell, scheduleText, syncBody, syncDraftFrom, syncStatus, validateSyncDraft } from './sync';
import { SyncPage } from './sync.page';

const me = (role: Role): Me => ({
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const DEST = { id: 'd1', provider: 'google_sheets' as const, label: 'Google Sheets (demonstração)', mode: 'sandbox' as const, status: 'active', created_at: '2026-11-12T10:00:00Z' };
const DESTINATIONS: SyncDestinationList = { meta: { modes: ['sandbox'], live_note: 'Login real indisponível: falta cadastrar o app do Google.' }, data: [DEST] };

const SYNC: SheetSync = {
  id: 's1',
  name: 'Mídia diária',
  project: { id: 'p1', name: 'Padaria Aurora' },
  destination: { id: 'd1', label: DEST.label, mode: 'sandbox', status: 'active' },
  metrics: ['meta_ads:spend', 'meta_ads:cpa'],
  days: 30,
  frequency: 'daily',
  active: true,
  spreadsheet_url: null,
  last_run_at: '2026-11-12T10:00:00Z',
  last_status: 'ok',
  last_error: null,
  has_preview: true,
  created_at: '2026-11-12T10:00:00Z',
};

const CATALOG: MetricDefinition[] = [
  { key: 'meta_ads:spend', provider: 'meta_ads', label: 'Investimento', description: '', unit: 'currency', kind: 'additive', direction: 'neutral', decimals: 2, featured: true },
  { key: 'meta_ads:cpa', provider: 'meta_ads', label: 'Custo por conversão (CPA)', description: '', unit: 'currency', kind: 'derived', direction: 'lower_is_better', decimals: 2, featured: true },
] as MetricDefinition[];
const PROVIDERS = [{ key: 'meta_ads', name: 'Meta Ads' }] as Provider[];

describe('helpers do Sync', () => {
  it('valida o rascunho com os limites do backend', () => {
    const draft = emptySyncDraft([DEST]);
    expect(draft.connection_id).toBe('d1'); // um destino só: já escolhido
    expect(validateSyncDraft(draft)).toEqual({
      project_id: 'Escolha o projeto.',
      name: 'Dê um nome à exportação.',
      metrics: 'Escolha ao menos uma métrica.',
    });
    expect(validateSyncDraft({ ...draft, project_id: 'p1', name: 'x', metrics: ['a:b'], days: '3' })).toEqual({ days: 'Use de 7 a 400 dias.' });
    expect(validateSyncDraft({ ...draft, project_id: 'p1', name: 'x', metrics: ['a:b'], days: '400' })).toEqual({});
  });

  it('corpo do POST tem projeto e destino; o do PATCH não', () => {
    const create = { ...emptySyncDraft([DEST]), project_id: 'p1', name: ' Mídia ', metrics: ['meta_ads:spend'], days: '90' };
    expect(syncBody(create)).toEqual({ project_id: 'p1', connection_id: 'd1', name: 'Mídia', metrics: ['meta_ads:spend'], days: 90, frequency: 'daily' });
    expect(syncBody({ ...syncDraftFrom(SYNC), frequency: 'weekly' })).toEqual({ name: 'Mídia diária', metrics: SYNC.metrics, days: 30, frequency: 'weekly' });
  });

  it('textos de situação, agenda e prévia', () => {
    expect(syncStatus(SYNC)).toEqual({ text: 'OK', tone: 'ok' });
    expect(syncStatus({ ...SYNC, last_status: 'error' }).text).toBe('Erro');
    expect(syncStatus({ ...SYNC, last_status: 'running' }).text).toBe('Rodando');
    expect(syncStatus({ ...SYNC, active: false }).text).toBe('Pausada');
    expect(syncStatus({ ...SYNC, last_status: null }).text).toBe('Ainda não rodou');
    expect(scheduleText({ frequency: 'weekly', days: 90 })).toBe('Semanal · últimos 90 dias');
    expect(previewCell(1234.5)).toBe('1.234,5');
    expect(previewCell(null)).toBe('—');
    expect(previewCell('2026-11-01')).toBe('2026-11-01');
  });
});

describe('SyncPage', () => {
  let fixture: ComponentFixture<SyncPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let toast: DsToastService;
  const start = vi.fn();

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
    TestBed.tick();
  }
  const button = (text: string, root: ParentNode = el) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
  const card = (id: string) => el.querySelector<HTMLElement>(`[data-id="${id}"]`)!;

  async function mount(role: Role = 'analyst', destinations: SyncDestinationList = DESTINATIONS, syncs: SheetSync[] = [SYNC]): Promise<void> {
    localStorage.clear();
    start.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
        { provide: OAuthService, useValue: { start } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(DsToastService);
    fixture = TestBed.createComponent(SyncPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    if (role !== 'client') {
      const req = backend.expectOne('/api/sync/destinations');
      expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
      req.flush(destinations);
      backend.expectOne('/api/sheet-syncs').flush({ data: syncs });
      await tick();
    }
  }

  afterEach(() => backend.verify());

  it('lista destinos e exportações; sem login real, mostra só a demonstração e o aviso', async () => {
    await mount();
    expect(el.querySelector('[data-testid="destinations"]')?.textContent).toContain('Google Sheets (demonstração)');
    expect(button('Conectar conta Google')).toBeUndefined();
    expect(button('Conectar em demonstração')).toBeDefined();
    expect(el.querySelector('[data-testid="live-note"]')?.textContent).toContain('falta cadastrar o app do Google');

    const sync = card('s1');
    expect(sync.textContent).toContain('Mídia diária');
    expect(sync.textContent).toContain('Padaria Aurora → Google Sheets (demonstração)');
    expect(sync.textContent).toContain('Diária · últimos 30 dias · 2 métricas');
    expect(sync.querySelector('[role="status"]')?.textContent?.trim()).toBe('OK');
    expect(sync.querySelector('a[href]')).toBeNull(); // demonstração: sem planilha
  });

  it('com login real: botão da conta Google; conectar usa o pop-up das integrações', async () => {
    await mount('analyst', { meta: { modes: ['sandbox', 'live'], live_note: null }, data: [] }, []);
    expect(el.querySelector('[data-testid="sync-empty"]')?.textContent).toContain('Cada dia vira uma linha e cada métrica uma coluna');
    expect(button('Nova exportação')?.disabled).toBe(true);

    let resolve!: (o: unknown) => void;
    start.mockReturnValue({ flow: 'f', via: 'popup', result: new Promise((r) => (resolve = r)), cancel: vi.fn(), dispose: vi.fn() });
    button('Conectar conta Google')!.click();
    await tick();
    expect(start).toHaveBeenCalledWith({ provider: 'google_sheets', tenantId: 't1', mode: 'live' });
    expect(el.textContent).toContain('Autorizando na outra janela…');

    const success = vi.spyOn(toast, 'success');
    resolve({ status: 'success', provider: 'google_sheets', connectionId: 'd9' });
    await tick();
    backend.expectOne('/api/sync/destinations').flush({ meta: { modes: ['sandbox', 'live'], live_note: null }, data: [{ ...DEST, id: 'd9', mode: 'live', label: 'Google Sheets · ana@agencia.com' }] });
    await tick();
    expect(success).toHaveBeenCalledWith('Google Sheets conectado', expect.anything());
    expect(el.textContent).toContain('Google Sheets · ana@agencia.com');
  });

  it('cria a exportação com projeto, métricas, janela e frequência', async () => {
    await mount('owner', DESTINATIONS, []);
    button('Nova exportação')!.click();
    await tick();
    backend.expectOne('/api/projects').flush({ data: [{ id: 'p1', name: 'Padaria Aurora', niche: 'ecommerce', created_at: '' }] });
    backend.expectOne('/api/metrics/catalog').flush({ data: CATALOG });
    backend.expectOne('/api/providers').flush({ data: PROVIDERS });
    backend.expectOne('/api/custom-metrics').flush({ data: [] });
    backend.expectOne('/api/manual-metrics').flush({ data: [] });
    await tick();

    const form = el.querySelector<HTMLFormElement>('[data-testid="sync-form"] form')!;
    form.dispatchEvent(new Event('submit'));
    await tick();
    expect(form.textContent).toContain('Escolha o projeto.');
    expect(form.textContent).toContain('Escolha ao menos uma métrica.');

    const project = form.querySelector<HTMLSelectElement>('select[name="project_id"]')!;
    project.value = 'p1';
    project.dispatchEvent(new Event('change'));
    await tick();
    backend.expectOne('/api/projects/p1/accounts').flush({ data: [{ id: 'a1', provider: 'meta_ads', name: 'Conta', kind: 'ad_account' }] });
    await tick();

    const name = form.querySelector<HTMLInputElement>('input[name="name"]')!;
    name.value = 'Mídia diária';
    name.dispatchEvent(new Event('input'));
    form.querySelector<HTMLInputElement>('app-metric-picker input[value="meta_ads:spend"]')!.click();
    form.querySelector<HTMLInputElement>('app-metric-picker input[value="meta_ads:cpa"]')!.click();
    button('90 dias', form)!.click();
    form.querySelector<HTMLInputElement>('input[name="frequency"][value="weekly"]')!.click();
    await tick();
    form.dispatchEvent(new Event('submit'));
    await tick();

    const req = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/sheet-syncs');
    expect(req.request.body).toEqual({ project_id: 'p1', connection_id: 'd1', name: 'Mídia diária', metrics: ['meta_ads:spend', 'meta_ads:cpa'], days: 90, frequency: 'weekly' });
    const success = vi.spyOn(toast, 'success');
    req.flush({ data: { ...SYNC, last_status: 'running' } }, { status: 201, statusText: 'Created' });
    await tick();
    backend.expectOne('/api/sheet-syncs').flush({ data: [{ ...SYNC, frequency: 'weekly', days: 90, last_status: 'running' }] });
    await tick();
    expect(success).toHaveBeenCalledWith('Exportação criada', { message: 'A primeira execução já começou.' });
    expect(el.querySelector('[data-testid="sync-form"]')).toBeNull();
    expect(card('s1').querySelector('[role="status"]')?.textContent?.trim()).toBe('Rodando');
  });

  it('mostra a prévia da demonstração, pausa e roda de novo', async () => {
    await mount();
    button('Ver prévia', card('s1'))!.click();
    await tick();
    backend.expectOne('/api/sheet-syncs/s1').flush({
      data: { ...SYNC, preview: { rows: [['Data', 'Investimento'], ['2026-11-01', 1234.5], ['2026-11-02', null]], total_rows: 30 } },
    });
    await tick();
    const preview = el.querySelector('[data-testid="preview"]')!;
    expect(preview.textContent).toContain('2 de 30 dias');
    expect([...preview.querySelectorAll('th')].map((th) => th.textContent?.trim())).toEqual(['Data', 'Investimento']);
    expect([...preview.querySelectorAll('tbody tr:first-child td')].map((td) => td.textContent?.trim())).toEqual(['2026-11-01', '1.234,5']);

    button('Pausar', card('s1'))!.click();
    await tick();
    const pause = backend.expectOne('/api/sheet-syncs/s1');
    expect(pause.request.method).toBe('PATCH');
    expect(pause.request.body).toEqual({ active: false });
    pause.flush({ data: { ...SYNC, active: false } });
    await tick();
    backend.expectOne('/api/sheet-syncs').flush({ data: [SYNC] });
    await tick();

    button('Rodar agora', card('s1'))!.click();
    await tick();
    const run = backend.expectOne('/api/sheet-syncs/s1/run');
    expect(run.request.method).toBe('POST');
    run.flush({ data: SYNC }, { status: 202, statusText: 'Accepted' });
    await tick();
    backend.expectOne('/api/sheet-syncs').flush({ data: [SYNC] });
    await tick();
  });

  it('mostra o erro da última execução e o link da planilha real', async () => {
    await mount('analyst', DESTINATIONS, [
      { ...SYNC, destination: { ...SYNC.destination!, mode: 'live' }, last_status: 'error', last_error: 'O Google Sheets recusou a gravação.', spreadsheet_url: 'https://docs.google.com/spreadsheets/d/x' },
    ]);
    const sync = card('s1');
    expect(sync.querySelector('[role="alert"]')?.textContent).toContain('O Google Sheets recusou a gravação.');
    const link = sync.querySelector<HTMLAnchorElement>('a[href]')!;
    expect(link.href).toBe('https://docs.google.com/spreadsheets/d/x');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(button('Ver prévia', sync)).toBeUndefined();
  });

  it('remove o destino avisando que as exportações vão junto', async () => {
    await mount();
    const destinations = el.querySelector('[data-testid="destinations"]')!;
    destinations.querySelector<HTMLButtonElement>('button[aria-label="Remover o destino Google Sheets (demonstração)"]')!.click();
    await tick();
    expect(destinations.textContent).toContain('As exportações deste destino também são removidas.');
    button('Remover', destinations)!.click();
    await tick();
    const req = backend.expectOne('/api/sync/destinations/d1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    backend.expectOne('/api/sync/destinations').flush({ ...DESTINATIONS, data: [] });
    backend.expectOne('/api/sheet-syncs').flush({ data: [] });
    await tick();
  });

  it('cliente vê o aviso e nada é carregado', async () => {
    await mount('client');
    backend.expectNone('/api/sync/destinations');
    expect(el.textContent).toContain('O Sync é da equipe da agência.');
  });
});
