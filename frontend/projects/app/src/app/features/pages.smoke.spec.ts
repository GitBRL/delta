import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Me } from '../core/api/api.types';
import { AuthService } from '../core/auth/auth.service';
import { LoginPage } from './auth/login.page';
import { RegisterPage } from './auth/register.page';
import { DesignSystemShowcasePage } from './design-system/showcase.page';
import { OverviewPage } from './overview/overview.page';
import { ProjectsPage } from './projects/projects.page';
import { Shell } from './shell/shell';

const ME: Me = {
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role: 'owner' }],
};

/** Renderiza cada tela para pegar erros de template/execução cedo. */
describe('telas (smoke)', () => {
  let backend: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { user: signal(ME), status: signal('authenticated'), isAuthenticated: signal(true) },
        },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
  });

  async function render<T>(component: Type<T>): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(component);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('login', async () => {
    const el = await render(LoginPage);
    expect(el.querySelector('h1')?.textContent).toContain('Entrar');
    expect(el.querySelectorAll('ds-text-field').length).toBe(2);
  });

  it('cadastro', async () => {
    const el = await render(RegisterPage);
    expect(el.querySelectorAll('ds-text-field').length).toBe(5);
  });

  it('shell mostra usuário e agência', async () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    TestBed.tick();
    backend.expectOne((r) => r.url === '/api/connections').flush({ data: [] });
    backend.expectOne((r) => r.url === '/api/billing').flush({ data: { plan: 'agencia', name: 'Agência', status: 'active', usable: true, trial_ends_at: null, current_period_ends_at: null, price_brl: null, limits: {}, features: {}, usage: {}, plans: [], checkout_available: false, contact: '' } });
    backend.expectOne((r) => r.url === '/api/whatsapp/conversations').flush({ data: [] });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Ana Lima');
    expect(el.textContent).toContain('Agência Norte');
  });

  it('shell avisa (equipe) quando uma conta real perdeu o acesso', async () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    TestBed.tick();
    backend.expectOne((r) => r.url === '/api/connections').flush({
      data: [
        { id: 'c1', provider: 'meta_ads', mode: 'live', status: 'expired', label: 'Conta', last_synced_at: null, last_error: 'Reconecte', accounts: [] },
        { id: 'c2', provider: 'ga4', mode: 'live', status: 'active', label: 'Site', last_synced_at: null, last_error: null, accounts: [] },
      ],
    });
    backend.expectOne((r) => r.url === '/api/billing').flush({ data: { plan: 'agencia', name: 'Agência', status: 'active', usable: true, trial_ends_at: null, current_period_ends_at: null, price_brl: null, limits: {}, features: {}, usage: {}, plans: [], checkout_available: false, contact: '' } });
    backend.expectOne((r) => r.url === '/api/whatsapp/conversations').flush({ data: [] });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.banner')?.textContent).toContain('Uma conta conectada perdeu o acesso');
    expect(el.querySelector('.banner a')?.getAttribute('href')).toBe('/integracoes');
    expect([...el.querySelectorAll('.nav-item')].map((a) => a.textContent?.trim())).toEqual(
      expect.arrayContaining(['Metas', 'Dados manuais']),
    );

    el.querySelector<HTMLButtonElement>('.banner-close')!.click();
    await fixture.whenStable();
    expect(el.querySelector('.banner')).toBeNull();
  });

  it('overview mostra os números reais da API', async () => {
    const fixture = TestBed.createComponent(OverviewPage);
    fixture.detectChanges();
    TestBed.tick();
    backend.expectOne((r) => r.url === '/api/overview').flush({
      data: {
        period: { start: '2026-10-13', end: '2026-11-11', label: '13/10/2026 – 11/11/2026' },
        compare: 'previous_period',
        generated_at: new Date().toISOString(),
        kpis: [
          { key: 'spend', label: 'Investimento em mídia', unit: 'currency', direction: 'neutral', decimals: 2, value: 1000, previous: 900, change_pct: 11.1, sentiment: 'neutral' },
        ],
        health: { acquisition: 90, engagement: 70, conversion: 50 },
        radar: [],
        projects: [
          { id: 'p1', name: 'Padaria Aurora', niche: null, status: 'healthy', summary: { critical: 0, attention: 0, opportunity: 0 }, headline: 'Tudo certo', detail: 'Nada a fazer.', providers: ['meta_ads'], spend: 1000 },
        ],
        counts: { projects: 1, with_data: 1, critical: 0, attention: 0, opportunity: 0 },
      },
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('ds-kpi-tile').length).toBe(1);
    expect(el.querySelector('ds-health-rings')).not.toBeNull();
    expect(el.textContent).not.toContain('Dados de demonstração');
    expect(el.textContent).toContain('Padaria Aurora');
  });
  it('projetos busca a lista com X-Tenant-Id da agência atual', async () => {
    const fixture = TestBed.createComponent(ProjectsPage);
    fixture.detectChanges();
    TestBed.tick();

    const req = backend.expectOne('/api/projects');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    req.flush({ data: [{ id: 'p1', name: 'Padaria Aurora', niche: 'negocio_local', created_at: '2026-11-12T10:00:00Z' }] });
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Padaria Aurora');
    expect(el.textContent).toContain('Negócio local');
  });

  it('vitrine do design system', async () => {
    const el = await render(DesignSystemShowcasePage);
    expect(el.querySelectorAll('ds-status-badge').length).toBeGreaterThanOrEqual(8);
    expect(el.querySelector('ds-health-rings')).not.toBeNull();
  });
});
