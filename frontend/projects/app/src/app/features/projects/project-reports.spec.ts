import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Me, SnapshotSummary } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { ProjectReports } from './project-reports';

const me = (role: string): Me => ({
  id: 'u1',
  name: 'Ana',
  email: 'ana@x.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const SNAP: SnapshotSummary = {
  id: 'v1',
  report_id: 'r1',
  project_id: 'p1',
  title: 'Relatório de outubro',
  period: { start: '2026-10-01', end: '2026-10-31' },
  comparison: null,
  pdf_status: 'ready',
  pdf_error: null,
  active_links: 1,
  created_at: new Date().toISOString(),
};

describe('ProjectReports', () => {
  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));

  async function render(role: string, list: SnapshotSummary[]) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
      ],
    });
    const backend = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ProjectReports);
    fixture.componentRef.setInput('projectId', 'p1');
    await drain();
    TestBed.tick();
    const req = backend.expectOne('/api/projects/p1/snapshots');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    req.flush({ data: list });
    await drain();
    TestBed.tick();
    await drain();
    backend.verify();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => localStorage.clear());

  it('cliente vê as versões publicadas do projeto, com link para cada uma', async () => {
    const el = await render('client', [SNAP]);
    const item = el.querySelector('[data-snapshot="v1"]')!;
    expect(item.textContent).toContain('Relatório de outubro');
    expect(item.textContent).toContain('01/10/2026 – 31/10/2026');
    expect(item.getAttribute('href')).toBe('/relatorios/versoes/v1');
    expect(el.textContent).not.toContain('Novo');
  });

  it('equipe: estado vazio com atalho para criar relatório no projeto', async () => {
    const el = await render('analyst', []);
    expect(el.textContent).toContain('Nenhuma versão publicada ainda');
    expect(el.querySelector('a.new')?.getAttribute('href')).toBe('/relatorios?novo=p1');
  });
});
