import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { DataImport, Me, Role } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { tenantInterceptor } from '../../core/http/interceptors';
import { ImportPage } from './import.page';
import { IMPORT_POLL_MS, groupReconnect, importSummaryLine, importTokenProblem, importTotals, readChecked } from './importer';

const TOKEN = 'rpt_abcdefghijklmnopqrstuvwxyz';

const QUEUED: DataImport = { id: 'i1', source: 'reportei', status: 'queued', summary: [], error: null, created_at: new Date().toISOString() };
const DONE: DataImport = {
  ...QUEUED,
  status: 'done',
  summary: {
    projects_created: 2,
    projects_existing: 1,
    timeline_events: 7,
    reconnect: [
      { project: 'Padaria Aurora', platform: 'Meta Ads', account: 'Conta Aurora' },
      { project: 'Clínica Sorriso', platform: 'Google Ads', account: '123-456-7890' },
      { project: 'Padaria Aurora', platform: 'Instagram', account: '@aurora' },
    ],
  },
};

describe('helpers do importador', () => {
  it('trata o resumo vazio (na fila) e escreve a linha de resumo', () => {
    expect(importTotals(QUEUED)).toEqual({ projectsCreated: 0, projectsExisting: 0, timelineEvents: 0, reconnect: [] });
    expect(importSummaryLine(QUEUED)).toBe('Na fila');
    expect(importSummaryLine(DONE)).toBe('2 projetos criados · 1 já existia · 7 marcos · 3 contas para reconectar');
    expect(importSummaryLine({ ...QUEUED, status: 'failed', error: 'Token recusado pelo Reportei.' })).toBe('Token recusado pelo Reportei.');
  });

  it('agrupa as contas por projeto, na ordem', () => {
    const groups = groupReconnect('i1', importTotals(DONE).reconnect);
    expect(groups.map((g) => g.project)).toEqual(['Padaria Aurora', 'Clínica Sorriso']);
    expect(groups[0].items.map((i) => i.key)).toEqual(['i1:0', 'i1:2']);
  });

  it('confere o token antes de enviar', () => {
    expect(importTokenProblem('')).toContain('Cole o token');
    expect(importTokenProblem('abc def ghi jkl mno pqr')).toContain('espaços');
    expect(importTokenProblem('curto')).toContain('incompleto');
    expect(importTokenProblem(TOKEN)).toBeNull();
  });
});

describe('ImportPage', () => {
  let fixture: ComponentFixture<ImportPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let toast: DsToastService;
  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
  }
  const me = (role: Role): Me => ({
    id: 'u1',
    name: 'Ana Lima',
    email: 'ana@agencia.com',
    two_factor_enabled: false,
    tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
  });
  const tokenInput = () => el.querySelector<HTMLInputElement>('input[name="reportei_token"]')!;
  const submit = () => el.querySelector('form')!.dispatchEvent(new Event('submit'));

  async function mount(role: Role = 'owner', history: DataImport[] = []): Promise<void> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([tenantInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(DsToastService);
    fixture = TestBed.createComponent(ImportPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    if (role === 'owner' || role === 'admin') {
      backend.expectOne('/api/imports').flush({ data: history });
      await tick();
    }
  }

  afterEach(() => {
    vi.useRealTimers();
    backend.verify();
  });

  it('importa: envia o token uma vez, acompanha a cada 2 s e mostra o checklist de contas', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await mount();
    const success = vi.spyOn(toast, 'success');

    expect(tokenInput().type).toBe('password');
    expect(el.textContent).toContain('Configurações da Empresa › API');
    tokenInput().value = TOKEN;
    tokenInput().dispatchEvent(new Event('input'));
    await tick();
    submit();
    await tick();

    const post = backend.expectOne('/api/imports/reportei');
    expect(post.request.method).toBe('POST');
    expect(post.request.headers.get('X-Tenant-Id')).toBe('t1');
    expect(post.request.body).toEqual({ token: TOKEN });
    post.flush({ data: QUEUED }, { status: 202, statusText: 'Accepted' });
    await tick();
    backend.expectOne('/api/imports').flush({ data: [QUEUED] });
    await tick();

    expect(tokenInput().value).toBe(''); // o token não fica na tela
    expect(el.querySelector('[data-testid="current-import"] .chip')?.textContent).toContain('Na fila');

    // ainda importando
    vi.advanceTimersByTime(IMPORT_POLL_MS);
    await tick();
    backend.expectOne('/api/imports/i1').flush({ data: { ...QUEUED, status: 'running' } });
    await tick();
    expect(el.querySelector('[data-testid="current-import"] .chip')?.textContent).toContain('Importando');

    // concluiu
    vi.advanceTimersByTime(IMPORT_POLL_MS);
    await tick();
    backend.expectOne('/api/imports/i1').flush({ data: DONE });
    await tick();
    backend.expectOne('/api/imports').flush({ data: [DONE] });
    await tick();

    expect(success).toHaveBeenCalledWith('Importação concluída', { message: importSummaryLine(DONE) });
    const current = el.querySelector<HTMLElement>('[data-testid="current-import"]')!;
    expect(current.querySelector('.totals')?.textContent).toContain('7');
    expect([...current.querySelectorAll('.group-title')].map((g) => g.textContent?.trim())).toEqual(['Padaria Aurora', 'Clínica Sorriso']);
    expect(current.querySelector('a[href="/integracoes"]')).not.toBeNull();
    expect(current.querySelector('[data-testid="reconnect-progress"]')?.textContent).toContain('0 de 3');

    current.querySelector<HTMLInputElement>('.checklist input')!.click();
    await tick();
    expect(current.querySelector('[data-testid="reconnect-progress"]')?.textContent).toContain('1 de 3');
    expect(readChecked('i1')).toEqual(['i1:0']);

    // parou de consultar
    vi.advanceTimersByTime(IMPORT_POLL_MS * 3);
    await tick();
    backend.expectNone('/api/imports/i1');
  });

  it('valida o token sem chamar a API e mostra o erro do servidor no campo', async () => {
    await mount();

    submit();
    await tick();
    backend.expectNone('/api/imports/reportei');
    expect(el.textContent).toContain('Cole o token da API do Reportei.');

    tokenInput().value = TOKEN;
    tokenInput().dispatchEvent(new Event('input'));
    await tick();
    submit();
    await tick();
    backend.expectOne('/api/imports/reportei').flush(
      { message: 'x', errors: { token: ['Cole o token da API do Reportei (Configurações da Empresa › API).'] } },
      { status: 422, statusText: 'Unprocessable Content' },
    );
    await tick();
    expect(el.querySelector('ds-text-field')?.textContent).toContain('Configurações da Empresa › API');
  });

  it('mostra o histórico e abre uma importação que falhou', async () => {
    const failed: DataImport = { ...QUEUED, id: 'i0', status: 'failed', error: 'O Reportei recusou o token.' };
    await mount('owner', [DONE, failed]);

    const items = el.querySelectorAll<HTMLButtonElement>('.history-item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Concluída');
    expect(items[1].textContent).toContain('O Reportei recusou o token.');

    items[1].click();
    await tick();
    expect(el.querySelector('[data-testid="current-import"] [role="alert"]')?.textContent).toContain('O Reportei recusou o token.');
    expect(items[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('analista vê o aviso e não busca o histórico', async () => {
    await mount('analyst');
    backend.expectNone('/api/imports');
    expect(el.textContent).toContain('Só donos e administradores');
  });
});
