import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { InvitationPreview, Me } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { TenantService } from '../../core/tenant/tenant.service';
import { InvitationPage, sameEmail } from './invitation.page';

const PREVIEW: InvitationPreview = {
  tenant_name: 'Agência Norte',
  email: 'bia@empresa.com',
  role: 'analyst',
  inviter_name: 'Ana Lima',
  expires_at: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString(),
  status: 'pending',
  account_exists: false,
};

const ME = (email: string): Me => ({
  id: 'u9',
  name: 'Bia',
  email,
  two_factor_enabled: false,
  tenants: [{ id: 't0', name: 'Outra Agência', slug: 'outra', role: 'owner' }],
});

describe('sameEmail', () => {
  it('compara sem diferenciar maiúsculas e espaços', () => {
    expect(sameEmail(' Bia@Empresa.com', 'bia@empresa.com ')).toBe(true);
    expect(sameEmail('bia@empresa.com', 'ana@empresa.com')).toBe(false);
    expect(sameEmail(null, 'x')).toBe(false);
  });
});

describe('InvitationPage', () => {
  let fixture: ComponentFixture<InvitationPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let auth: {
    user: ReturnType<typeof signal<Me | null>>;
    isAuthenticated: ReturnType<typeof computed<boolean>>;
    ensureSession: ReturnType<typeof vi.fn>;
    acceptInvitation: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }
  async function settle(): Promise<void> {
    await tick();
    await fixture.whenStable();
  }
  const heading = () => el.querySelector('h1')?.textContent?.trim();
  const subtitle = () => el.querySelector('.subtitle')?.textContent?.trim();
  const button = (text: string) => [...el.querySelectorAll('button, a')].find((b) => b.textContent?.trim().startsWith(text)) as
    | HTMLElement
    | undefined;
  const type = (name: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  async function open(preview: InvitationPreview | null, sessionEmail: string | null = null): Promise<void> {
    const user = signal<Me | null>(sessionEmail ? ME(sessionEmail) : null);
    auth = {
      user,
      isAuthenticated: computed(() => user() !== null),
      ensureSession: vi.fn().mockResolvedValue(sessionEmail !== null),
      acceptInvitation: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(InvitationPage);
    fixture.componentRef.setInput('token', 'tok123');
    el = fixture.nativeElement as HTMLElement;
    await tick(); // sem whenStable: ele esperaria a requisição pendente

    const req = backend.expectOne('/api/invitations/tok123');
    if (preview) req.flush({ data: preview });
    else req.flush({ message: 'Convite não encontrado.' }, { status: 404, statusText: 'Not Found' });
    await settle();
  }

  afterEach(() => {
    backend.verify();
    localStorage.clear();
  });

  it('link inválido', async () => {
    await open(null);

    expect(heading()).toBe('Convite não encontrado');
    expect(button('Ir para o login')?.getAttribute('href')).toBe('/login');
  });

  it('logado com o e-mail do convite: aceita, entra na agência e vai para a visão geral', async () => {
    await open(PREVIEW, 'Bia@Empresa.com');
    const tenant = TestBed.inject(TenantService);
    const select = vi.spyOn(tenant, 'select');
    const success = vi.spyOn(TestBed.inject(DsToastService), 'success');
    auth.acceptInvitation.mockResolvedValue({ tenant_id: 't9', tenant_name: 'Agência Norte' });

    expect(heading()).toBe('Você foi convidado');
    expect(subtitle()).toBe('Ana Lima convidou você para a Agência Norte como analista.');
    expect(el.textContent).toContain('conecta contas, cria projetos, relatórios e indicadores');

    button('Aceitar convite')?.click();
    await settle();

    expect(auth.acceptInvitation).toHaveBeenCalledWith('tok123');
    expect(select).toHaveBeenCalledWith('t9');
    expect(success).toHaveBeenCalledWith('Bem-vindo à Agência Norte', { message: 'Você já faz parte da equipe.' });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/overview');
  });

  it('mostra a mensagem do servidor quando o aceite é recusado', async () => {
    await open(PREVIEW, 'bia@empresa.com');
    auth.acceptInvitation.mockRejectedValue(
      new HttpErrorResponse({ status: 403, error: { message: 'Este convite é para bia@empresa.com.' } }),
    );

    button('Aceitar convite')?.click();
    await settle();

    expect(el.querySelector('.general-error')?.textContent).toContain('Este convite é para bia@empresa.com.');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('logado com outra conta: sai e volta ao login com o e-mail do convite', async () => {
    await open(PREVIEW, 'ana@agencia.com');

    expect(el.textContent).toContain('mas você entrou com outra conta');
    button('Sair e entrar com bia@empresa.com')?.click();
    await settle();

    expect(auth.logout).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { redirect: '/convite/tok123', email: 'bia@empresa.com' },
    });
  });

  it('sem sessão e com conta: leva ao login com volta para o convite', async () => {
    await open({ ...PREVIEW, account_exists: true });

    const link = button('Entrar para aceitar');
    expect(link?.tagName).toBe('A');
    const href = decodeURIComponent(link?.getAttribute('href') ?? '');
    expect(href).toContain('/login?');
    expect(href).toContain('redirect=/convite/tok123');
    expect(href).toContain('email=bia@empresa.com');
    expect(el.querySelector('form')).toBeNull();
  });

  it('sem conta: cria a conta com o e-mail do convite e já entra', async () => {
    await open(PREVIEW);
    auth.acceptInvitation.mockResolvedValue({ tenant_id: 't9', tenant_name: 'Agência Norte' });

    expect(el.textContent).toContain('Crie sua senha para entrar como bia@empresa.com');

    type('name', ' Bia Souza ');
    type('password', 'senha-forte-123');
    type('password_confirmation', 'outra-senha-123');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(auth.acceptInvitation).not.toHaveBeenCalled();
    expect(el.textContent).toContain('As senhas não conferem.');

    type('password_confirmation', 'senha-forte-123');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(auth.acceptInvitation).toHaveBeenCalledWith('tok123', {
      name: 'Bia Souza',
      password: 'senha-forte-123',
      password_confirmation: 'senha-forte-123',
    });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/overview');
  });

  it('se a conta já existe (409), troca o formulário pelo "Entrar para aceitar"', async () => {
    await open(PREVIEW);
    auth.acceptInvitation.mockRejectedValue(
      new HttpErrorResponse({
        status: 409,
        error: { message: 'Já existe uma conta com este e-mail. Entre para aceitar o convite.' },
      }),
    );

    type('name', 'Bia');
    type('password', 'senha-forte-123');
    type('password_confirmation', 'senha-forte-123');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('.general-error')?.textContent).toContain('Já existe uma conta com este e-mail');
    expect(button('Entrar para aceitar')).toBeDefined();
  });

  it('convite expirado ou já aceito explica o que fazer', async () => {
    await open({ ...PREVIEW, status: 'expired' });
    expect(heading()).toBe('Convite expirado');
    expect(subtitle()).toContain('Peça um novo a Ana Lima');
    expect(button('Aceitar convite')).toBeUndefined();
  });

  it('convite já aceito leva para o login', async () => {
    await open({ ...PREVIEW, status: 'accepted' });
    expect(heading()).toBe('Convite já aceito');
    expect(subtitle()).toContain('Entre com bia@empresa.com');
    expect(decodeURIComponent(button('Entrar')?.getAttribute('href') ?? '')).toContain('email=bia@empresa.com');
  });
});
