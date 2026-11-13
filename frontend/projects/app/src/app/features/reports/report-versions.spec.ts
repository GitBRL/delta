import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { Me, ShareLink, SnapshotSummary } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { PDF_POLL_MS, ReportVersions } from './report-versions';
import { linkState } from './share-dialog';

const ME: Me = {
  id: 'u1',
  name: 'Ana',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role: 'owner' }],
};

const snap = (over: Partial<SnapshotSummary>): SnapshotSummary => ({
  id: 'v?',
  report_id: 'r1',
  project_id: 'p1',
  title: 'Relatório de outubro',
  period: { start: '2026-10-01', end: '2026-10-31' },
  comparison: null,
  pdf_status: 'ready',
  pdf_error: null,
  active_links: 0,
  created_at: new Date().toISOString(),
  ...over,
});

const link = (over: Partial<ShareLink>): ShareLink => ({
  id: 'l?',
  snapshot_id: 'v1',
  protected: false,
  expires_at: null,
  revoked_at: null,
  active: true,
  view_count: 0,
  last_viewed_at: null,
  created_at: new Date().toISOString(),
  ...over,
});

describe('linkState', () => {
  it('descreve a situação do link', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    expect(linkState(link({}), now)).toBe('Sem validade');
    expect(linkState(link({ revoked_at: '2026-11-01T00:00:00Z' }), now)).toBe('Desativado');
    expect(linkState(link({ expires_at: '2026-11-01T00:00:00Z' }), now)).toBe('Expirado');
    expect(linkState(link({ expires_at: '2026-12-12T12:00:00Z' }), now)).toBe('Válido até 12/12/2026');
  });
});

describe('ReportVersions', () => {
  let fixture: ComponentFixture<ReportVersions>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
  }
  const button = (text: string, scope: ParentNode = el) =>
    [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().startsWith(text));

  async function setup(list: SnapshotSummary[]): Promise<void> {
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
    fixture = TestBed.createComponent(ReportVersions);
    fixture.componentRef.setInput('reportId', 'r1');
    el = fixture.nativeElement as HTMLElement;
    await tick();
    backend.expectOne('/api/reports/r1/snapshots').flush({ data: list });
    await tick();
  }

  afterEach(() => backend.verify());

  it('atualiza sozinho enquanto o PDF é gerado e para quando fica pronto', async () => {
    await setup([snap({ id: 'v1', pdf_status: 'pending' })]);
    expect(el.textContent).toContain('Gerando PDF…');
    expect(button('Baixar PDF')).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, PDF_POLL_MS + 100));
    TestBed.tick();
    backend.expectOne('/api/reports/r1/snapshots').flush({ data: [snap({ id: 'v1', pdf_status: 'ready' })] });
    await tick();

    expect(button('Baixar PDF')).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, PDF_POLL_MS + 100));
    TestBed.tick();
    backend.expectNone('/api/reports/r1/snapshots');
  }, 10_000);

  it('baixa o PDF com o header da agência e trata o "ainda gerando"', async () => {
    await setup([snap({ id: 'v1' })]);
    const info = vi.spyOn(TestBed.inject(DsToastService), 'info');
    button('Baixar PDF')!.click();
    await tick();
    const req = backend.expectOne('/api/snapshots/v1/pdf');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob([JSON.stringify({ status: 'pending', message: 'O PDF está sendo gerado.' })]), { status: 202, statusText: 'Accepted' });
    await tick();
    await tick();
    expect(info).toHaveBeenCalledWith('O PDF ainda está sendo gerado', { message: 'O PDF está sendo gerado.' });
  });

  it('PDF falho: mostra o motivo e tenta de novo', async () => {
    await setup([snap({ id: 'v1', pdf_status: 'failed', pdf_error: 'Gerador indisponível.' })]);
    expect(el.textContent).toContain('Gerador indisponível.');
    button('Tentar de novo')!.click();
    await tick();
    backend.expectOne((r) => r.method === 'POST' && r.url === '/api/snapshots/v1/pdf').flush({ data: snap({ id: 'v1', pdf_status: 'pending' }) }, { status: 202, statusText: 'Accepted' });
    await tick();
    expect(el.textContent).toContain('Gerando PDF…');
  });

  it('compartilha com senha e validade, mostra o link uma vez e desativa', async () => {
    await setup([snap({ id: 'v1' })]);
    button('Compartilhar')!.click();
    await tick();
    backend.expectOne('/api/snapshots/v1/links').flush({ data: [link({ id: 'l0', view_count: 3, protected: true })] });
    await tick();

    const dialog = el.querySelector<HTMLElement>('app-share-dialog [role="dialog"]')!;
    expect(dialog.querySelector('[data-link="l0"]')?.textContent).toContain('3 visualizações');

    const password = dialog.querySelector<HTMLInputElement>('input[name="share_password"]')!;
    password.value = 'abc';
    password.dispatchEvent(new Event('input'));
    await tick();
    dialog.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await tick();
    backend.expectNone((r) => r.method === 'POST');
    expect(dialog.textContent).toContain('pelo menos 4 caracteres');

    password.value = 'aurora';
    password.dispatchEvent(new Event('input'));
    const validity = dialog.querySelector<HTMLSelectElement>('select[name="share_validity"]')!;
    validity.value = '7';
    validity.dispatchEvent(new Event('change'));
    await tick();
    dialog.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await tick();

    const req = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/snapshots/v1/links');
    expect(req.request.body).toEqual({ expires_in_days: 7, password: 'aurora' });
    req.flush({ data: link({ id: 'l1', protected: true }), url: 'http://localhost:4300/r/abc' }, { status: 201, statusText: 'Created' });
    await tick();
    backend.expectOne('/api/snapshots/v1/links').flush({ data: [link({ id: 'l1', protected: true }), link({ id: 'l0' })] });
    backend.expectOne('/api/reports/r1/snapshots').flush({ data: [snap({ id: 'v1', active_links: 2 })] });
    await tick();

    expect(dialog.querySelector<HTMLInputElement>('input.url')?.value).toBe('http://localhost:4300/r/abc');

    button('Desativar', dialog.querySelector('[data-link="l0"]')!)!.click();
    await tick();
    backend.expectOne((r) => r.method === 'DELETE' && r.url === '/api/links/l0').flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    backend.expectOne('/api/snapshots/v1/links').flush({ data: [] });
    backend.expectOne('/api/reports/r1/snapshots').flush({ data: [snap({ id: 'v1' })] });
    await tick();

    dialog.querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')!.click();
    await tick();
    expect(el.querySelector('app-share-dialog')).toBeNull();
  });
});
