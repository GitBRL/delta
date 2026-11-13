import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Billing, Me, Role } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { PlanPage } from './plan.page';

const me = (role: Role): Me => ({
  id: 'u1',
  name: 'Ana',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const LIMITS = { projects: 5, seats: 3, live_connections: 15, automations: 10, whatsapp_messages: 300, ai_tokens: 500_000 };
const BILLING: Billing = {
  plan: 'essencial',
  name: 'Essencial',
  status: 'active',
  usable: true,
  trial_ends_at: null,
  current_period_ends_at: '2026-12-12T12:00:00Z',
  price_brl: null,
  limits: LIMITS,
  features: { api: false, mcp: false, white_label: false, publishing: true, studio: false, ads_management: false },
  usage: { projects: 4, seats: 3, live_connections: 2, automations: 0, whatsapp_messages: 120, ai_tokens: 0 },
  plans: [
    { key: 'essencial', name: 'Essencial', price_brl: null, limits: LIMITS, features: { api: false, mcp: false, white_label: false, publishing: true, studio: false, ads_management: false } },
    { key: 'pro', name: 'Pro', price_brl: 390, limits: { ...LIMITS, projects: 25 }, features: { api: true, mcp: true, white_label: false, publishing: true, studio: true, ads_management: true } },
    { key: 'agencia', name: 'Agência', price_brl: null, limits: { ...LIMITS, projects: null }, features: { api: true, mcp: true, white_label: true, publishing: true, studio: true, ads_management: true } },
  ],
  checkout_available: false,
  contact: 'Para mudar de plano, fale com a equipe do Delta.',
};

const drain = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('PlanPage', () => {
  let fixture: ComponentFixture<PlanPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  const tick = async () => {
    await drain();
    TestBed.tick();
    await drain();
    TestBed.tick();
  };

  async function mount(role: Role, billing: Billing | null = BILLING): Promise<void> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } }],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PlanPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    if (billing) {
      backend.expectOne('/api/billing').flush({ data: billing });
      await tick();
    }
  }

  afterEach(() => backend.verify());

  it('mostra plano, uso com barras, recursos e a comparação', async () => {
    await mount('owner');
    expect(el.querySelector('[data-testid="plan-summary"]')?.textContent).toContain('Essencial');
    expect(el.querySelector('[data-testid="plan-summary"]')?.textContent).toContain('Ativo');

    const projects = el.querySelector('[data-limit="projects"]')!;
    expect(projects.textContent).toContain('4 de 5');
    expect(projects.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('80');
    expect(projects.querySelector('.fill')?.classList.contains('is-warn')).toBe(true);
    expect(el.querySelector('[data-limit="seats"] .fill')?.classList.contains('is-full')).toBe(true);
    expect(el.querySelector('[data-limit="whatsapp_messages"]')?.textContent).toContain('do mês');

    expect(el.textContent).toContain('Studio');
    const compare = el.querySelector('table.compare')!;
    expect(compare.textContent).toContain('Sob consulta');
    expect(compare.textContent).toContain('R$');
    expect(compare.textContent).toContain('Sem limite');
    expect(compare.querySelector('.is-current')?.textContent).toContain('Essencial');

    const contact = el.querySelector<HTMLButtonElement>('[data-testid="plan-contact-button"]')!;
    expect(contact.textContent?.trim()).toBe('Falar com a equipe');
    contact.click();
    await tick();
    expect(el.querySelector('[data-testid="plan-contact-text"]')?.textContent).toContain('fale com a equipe do Delta');
  });

  it('teste vencido avisa que nada novo pode ser criado', async () => {
    await mount('admin', { ...BILLING, plan: 'trial', name: 'Teste grátis', status: 'trialing', usable: false, trial_ends_at: '2026-11-01T00:00:00Z', current_period_ends_at: null });
    expect(el.textContent).toContain('O teste grátis terminou.');
    expect(el.querySelector('[data-testid="trial-days"]')?.textContent).toContain('o teste terminou em');
  });

  it('analista não vê o plano (nem busca)', async () => {
    await mount('analyst', null);
    backend.expectNone('/api/billing');
    expect(el.textContent).toContain('Só donos e administradores');
  });
});
