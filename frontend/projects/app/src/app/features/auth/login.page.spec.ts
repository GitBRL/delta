import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/auth/auth.service';
import { AssertedCredential, WebAuthnBrowser } from '../../core/auth/webauthn';
import { LoginPage, safeRedirect } from './login.page';

describe('safeRedirect', () => {
  it('aceita só caminhos internos', () => {
    expect(safeRedirect('/convite/abc')).toBe('/convite/abc');
    expect(safeRedirect('/projetos/1?x=2')).toBe('/projetos/1?x=2');
    expect(safeRedirect(undefined)).toBe('/overview');
    expect(safeRedirect('')).toBe('/overview');
    expect(safeRedirect('//evil.com')).toBe('/overview');
    expect(safeRedirect('/\\evil.com')).toBe('/overview');
    expect(safeRedirect('https://evil.com')).toBe('/overview');
    expect(safeRedirect('javascript:alert(1)')).toBe('/overview');
  });
});

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let el: HTMLElement;
  let router: Router;
  const login = vi.fn();
  const passkeyLoginOptions = vi.fn();
  const passkeyLogin = vi.fn();
  const webauthn = { supported: vi.fn(() => false), get: vi.fn(), create: vi.fn() };

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function settle(): Promise<void> {
    await drain();
    TestBed.tick();
    await fixture.whenStable();
  }
  const input = (name: string) => el.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
  const type = (name: string, value: string) => {
    input(name).value = value;
    input(name).dispatchEvent(new Event('input'));
  };

  async function open(inputs: Record<string, string>): Promise<void> {
    login.mockReset().mockResolvedValue('authenticated');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { login, passkeyLoginOptions, passkeyLogin, user: signal(null), status: signal('guest') } },
        { provide: WebAuthnBrowser, useValue: webauthn },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoginPage);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    el = fixture.nativeElement as HTMLElement;
    await settle();
  }

  async function submit(): Promise<void> {
    type('password', 'senha-forte-123');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
  }

  it('preenche o e-mail sugerido e volta para o convite depois de entrar', async () => {
    await open({ redirect: '/convite/tok123', email: 'bia@empresa.com' });

    expect(input('email').value).toBe('bia@empresa.com');
    await submit();

    expect(login).toHaveBeenCalledWith({ email: 'bia@empresa.com', password: 'senha-forte-123', remember: true });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/convite/tok123');
  });

  it('ignora destino externo (open redirect)', async () => {
    await open({ redirect: '//evil.com/roubo' });
    type('email', 'ana@agencia.com');
    await submit();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/overview');
  });

  describe('passkey', () => {
    const ASSERTED: AssertedCredential = {
      id: 'cred-1',
      rawId: new Uint8Array([1, 2]).buffer,
      type: 'public-key',
      response: {
        clientDataJSON: new Uint8Array([3]).buffer,
        authenticatorData: new Uint8Array([4]).buffer,
        signature: new Uint8Array([5]).buffer,
        userHandle: new Uint8Array([6]).buffer,
      },
    };
    const passkeyButton = () => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Entrar com passkey');

    beforeEach(() => {
      passkeyLoginOptions.mockReset().mockResolvedValue({ challenge: 'AQID', rpId: 'localhost', userVerification: 'required' });
      passkeyLogin.mockReset().mockResolvedValue(undefined);
      webauthn.get.mockReset().mockResolvedValue(ASSERTED);
    });

    it('não aparece se o navegador não suporta', async () => {
      webauthn.supported.mockReturnValue(false);
      await open({});
      expect(passkeyButton()).toBeUndefined();
    });

    it('entra com a passkey (sem código do 2FA) e segue para o destino', async () => {
      webauthn.supported.mockReturnValue(true);
      await open({ redirect: '/projetos' });
      passkeyButton()!.click();
      await settle();

      expect(webauthn.get).toHaveBeenCalledWith({ challenge: 'AQID', rpId: 'localhost', userVerification: 'required' });
      expect(passkeyLogin).toHaveBeenCalledWith(
        {
          id: 'cred-1',
          rawId: 'AQI',
          type: 'public-key',
          response: { clientDataJSON: 'Aw', authenticatorData: 'BA', signature: 'BQ', userHandle: 'Bg' },
        },
        true,
      );
      expect(router.navigateByUrl).toHaveBeenCalledWith('/projetos');
      expect(login).not.toHaveBeenCalled();
    });

    it('explica o cancelamento e o erro do servidor', async () => {
      webauthn.supported.mockReturnValue(true);
      await open({});
      webauthn.get.mockRejectedValueOnce(new DOMException('cancelado', 'NotAllowedError'));
      passkeyButton()!.click();
      await settle();
      expect(el.querySelector('.general-error')?.textContent).toContain('Login com passkey cancelado.');
      expect(passkeyLogin).not.toHaveBeenCalled();

      passkeyLogin.mockRejectedValueOnce(
        new HttpErrorResponse({ status: 422, error: { message: 'x', errors: { credential: ['Passkey não reconhecida. Ela pode ter sido removida da sua conta.'] } } }),
      );
      passkeyButton()!.click();
      await settle();
      expect(el.querySelector('.general-error')?.textContent).toContain('Passkey não reconhecida');
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });
});
