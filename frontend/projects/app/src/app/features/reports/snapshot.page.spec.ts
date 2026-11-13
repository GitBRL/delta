import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Me, Snapshot } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { REPORT_DATA } from './report-fixtures';
import { SnapshotPage } from './snapshot.page';

const me = (role: string): Me => ({
  id: 'u1',
  name: 'Ana',
  email: 'ana@x.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const SNAPSHOT: Snapshot = {
  id: 'v1',
  report_id: 'r1',
  project_id: 'p1',
  title: 'Relatório de outubro',
  period: { start: '2026-10-01', end: '2026-10-31' },
  comparison: null,
  pdf_status: 'ready',
  pdf_error: null,
  active_links: 0,
  created_at: new Date().toISOString(),
  data: REPORT_DATA,
};

describe('SnapshotPage', () => {
  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));

  async function render(role: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
      ],
    });
    const backend = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SnapshotPage);
    fixture.componentRef.setInput('id', 'v1');
    await drain();
    TestBed.tick();
    backend.expectOne('/api/snapshots/v1').flush({ data: SNAPSHOT });
    await drain();
    TestBed.tick();
    await drain();
    backend.verify();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => localStorage.clear());

  it('equipe: relatório, PDF e compartilhar; volta para o editor', async () => {
    const el = await render('owner');
    expect(el.querySelector('app-report-view')).not.toBeNull();
    expect(el.textContent).toContain('Baixar PDF');
    expect(el.textContent).toContain('Compartilhar');
    expect(el.querySelector('a.back')?.getAttribute('href')).toBe('/relatorios/r1');
  });

  it('cliente: sem compartilhar, volta para o projeto', async () => {
    const el = await render('client');
    expect(el.textContent).not.toContain('Compartilhar');
    expect(el.querySelector('a.back')?.getAttribute('href')).toBe('/projetos/p1');
  });
});
