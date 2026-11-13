import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Branding, Me, Role } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { PlanLimitService } from '../../core/billing/plan-limit';
import { Shell } from './shell';

const me = (role: Role): Me => ({
  id: 'u1',
  name: 'Bruno Costa',
  email: 'bruno@padaria.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const BRANDING: Branding = {
  name: 'Norte Digital',
  color: '#ff375f',
  logo_url: '/api/public/branding/t1/logo?signature=x',
  hide_delta_badge: true,
  display_name: 'Norte Digital',
  primary_color: '#ff375f',
  email_reply_to: null,
  custom_domain: null,
  domain_status: null,
  cname_target: 'links.delta.app',
};

describe('Shell', () => {
  let fixture: ComponentFixture<Shell>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }
  const navLabels = () =>
    [...el.querySelectorAll('.nav .nav-label')].map((s) => s.textContent?.trim());
  const headings = () =>
    [...el.querySelectorAll('.nav .nav-heading')].map((h) => h.textContent?.trim());
  async function openMenu(): Promise<HTMLElement> {
    el.querySelector<HTMLButtonElement>('button.account')!.click();
    await tick();
    return el.querySelector<HTMLElement>('#account-menu')!;
  }

  async function mount(role: Role): Promise<void> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { user: signal(me(role)), status: signal('authenticated'), logout: vi.fn() },
        },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Shell);
    el = fixture.nativeElement as HTMLElement;
    await tick();
  }

  afterEach(() => backend.verify());

  it('portal do cliente: marca da agência (logo e cor) e menu enxuto', async () => {
    await mount('client');
    const req = backend.expectOne('/api/branding');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    req.flush({ data: BRANDING });
    await tick();

    expect(el.classList.contains('is-client')).toBe(true);
    expect(el.style.getPropertyValue('--ds-accent')).toBe('#ff375f');
    const logo = el.querySelector<HTMLImageElement>('.agency-brand img.agency-logo');
    expect(logo?.getAttribute('src')).toBe(BRANDING.logo_url);
    expect(logo?.getAttribute('alt')).toBe('Norte Digital');
    expect(el.querySelector('app-delta-logo')).toBeNull();
    expect(navLabels()).toEqual(['Visão geral', 'Projetos', 'Publicações', 'Metas']);
    expect(headings()).toEqual([]); // menu enxuto, sem grupos
  });

  it('cliente sem logo vê o nome da agência', async () => {
    await mount('client');
    backend.expectOne('/api/branding').flush({ data: { ...BRANDING, logo_url: null } });
    await tick();
    expect(el.querySelector('.agency-name')?.textContent?.trim()).toBe('Norte Digital');
  });

  it('equipe vê o Delta, Ações e Configurações (sem buscar a marca)', async () => {
    await mount('owner');
    backend.expectOne('/api/connections').flush({ data: [] });
    backend.expectOne('/api/billing').flush({
      data: {
        plan: 'agencia',
        name: 'Agência',
        status: 'active',
        usable: true,
        trial_ends_at: null,
        current_period_ends_at: null,
        price_brl: null,
        limits: {},
        features: {},
        usage: {},
        plans: [],
        checkout_available: false,
        contact: '',
      },
    });
    backend.expectOne('/api/whatsapp/conversations').flush({ data: [] });
    backend.expectNone('/api/branding');
    await tick();

    expect(el.classList.contains('is-client')).toBe(false);
    expect(el.querySelector('app-delta-logo')).not.toBeNull();
    const labels = navLabels();
    expect(labels).toContain('Ações');
    expect(labels).toContain('Configurações');
    expect(labels).toContain('Integrações');
    expect(labels).toContain('Conversas');
    expect(labels).toContain('Sync');
    expect(labels).toContain('Publicações');
    expect(labels).toContain('Studio');
    expect(labels).toContain('Anúncios');
    expect(el.querySelector('[data-testid="trial-banner"]')).toBeNull(); // plano ativo: sem aviso
    expect(el.querySelector('.nav-badge')).toBeNull(); // nada não lido

    expect(headings()).toEqual(['Análise', 'Operação', 'Dados', 'Agência']);
    expect(labels).not.toContain('Design system'); // vitrine fica no menu da conta, não na navegação

    const account = el.querySelector<HTMLButtonElement>('button.account')!;
    expect(account.textContent).toContain('Bruno Costa');
    expect(account.getAttribute('aria-expanded')).toBe('false');
    const menu = await openMenu();
    expect(account.getAttribute('aria-expanded')).toBe('true');
    expect(menu.querySelector('a[href="/conta"]')?.textContent).toContain('Minha conta');
    expect(menu.querySelector('a[href="/design-system"]')).not.toBeNull();
    expect([...menu.querySelectorAll('[role="radio"]')].map((r) => r.textContent?.trim())).toEqual([
      'Sistema',
      'Claro',
      'Escuro',
    ]);
  });

  it('menu da conta: troca o tema, fecha com Esc (foco volta ao botão) e com clique fora', async () => {
    await mount('analyst');
    backend.expectOne('/api/connections').flush({ data: [] });
    backend.expectOne('/api/whatsapp/conversations').flush({ data: [] });
    await tick();
    expect(headings()).toEqual(['Análise', 'Operação', 'Dados']); // analista não vê Agência

    let menu = await openMenu();
    const dark = [...menu.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (r) => r.textContent?.trim() === 'Escuro',
    )!;
    dark.click();
    await tick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(dark.getAttribute('aria-checked')).toBe('true');

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(el.querySelector('#account-menu')).toBeNull();
    expect(document.activeElement).toBe(el.querySelector('button.account'));

    menu = await openMenu();
    expect(menu).not.toBeNull();
    document.body.click();
    await tick();
    expect(el.querySelector('#account-menu')).toBeNull();

    [...(await openMenu()).querySelectorAll<HTMLButtonElement>('[role="radio"]')][0].click(); // volta ao tema do sistema
    await tick();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('mostra no menu quantas mensagens do WhatsApp estão sem ler', async () => {
    await mount('analyst');
    backend.expectOne('/api/connections').flush({ data: [] });
    const conversation = (phone: string, unread: number) => ({
      phone,
      phone_display: phone,
      contact: null,
      last_message: { direction: 'in', body: 'Oi', created_at: '2026-11-12T10:00:00Z' },
      unread,
      window_open: true,
    });
    backend
      .expectOne('/api/whatsapp/conversations')
      .flush({ data: [conversation('+5511999990001', 2), conversation('+5511999990002', 1)] });
    await tick();

    const badge = el.querySelector('a[href="/conversas"] .nav-badge');
    expect(badge?.textContent?.trim()).toBe('3');
    expect(badge?.getAttribute('aria-label')).toBe('3 mensagens não lidas');
  });

  it('cliente não busca conversas', async () => {
    await mount('client');
    backend.expectOne('/api/branding').flush({ data: BRANDING });
    backend.expectNone('/api/whatsapp/conversations');
    await tick();
    expect(navLabels()).not.toContain('Conversas');
    expect(navLabels()).not.toContain('Sync');
    expect(navLabels()).not.toContain('Studio');
    expect(navLabels()).not.toContain('Anúncios');
    backend.expectNone('/api/billing');
    const menu = await openMenu(); // a conta é de todos os papéis
    expect(menu.querySelector('a[href="/conta"]')).not.toBeNull();
    expect(menu.querySelector('a[href="/design-system"]')).toBeNull();
  });
  it('dono vê o aviso do teste grátis acabando, com link para o plano', async () => {
    await mount('owner');
    backend.expectOne('/api/connections').flush({ data: [] });
    const ends = new Date(Date.now() + 2 * 86_400_000 - 60_000).toISOString();
    backend.expectOne('/api/billing').flush({
      data: {
        plan: 'trial',
        name: 'Teste grátis',
        status: 'trialing',
        usable: true,
        trial_ends_at: ends,
        current_period_ends_at: null,
        price_brl: null,
        limits: {},
        features: {},
        usage: {},
        plans: [],
        checkout_available: false,
        contact: '',
      },
    });
    backend.expectOne('/api/whatsapp/conversations').flush({ data: [] });
    await tick();

    const banner = el.querySelector('[data-testid="trial-banner"]');
    expect(banner?.textContent).toContain('O teste grátis termina em 2 dias');
    expect(banner?.querySelector('a')?.getAttribute('href')).toBe('/configuracoes/plano');
  });

  it('analista não busca o plano; um 402 abre "Limite do plano" sem o link', async () => {
    await mount('analyst');
    backend.expectOne('/api/connections').flush({ data: [] });
    backend.expectOne('/api/whatsapp/conversations').flush({ data: [] });
    backend.expectNone('/api/billing');

    TestBed.inject(PlanLimitService).show({
      message: 'O plano Essencial permite até 5 projetos.',
      limit: 'projects',
      allowed: 5,
      used: 5,
    });
    await tick();
    const dialog = el.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('Limite do plano');
    expect(dialog?.textContent).toContain('O plano Essencial permite até 5 projetos.');
    expect(dialog?.textContent).toContain('Em uso: 5 de 5.');
    expect(dialog?.querySelector('a')).toBeNull();
    expect(dialog?.textContent).toContain('Peça a um dono ou administrador');

    [...dialog!.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Fechar')!
      .click();
    await tick();
    expect(el.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
