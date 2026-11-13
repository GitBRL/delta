import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { Me, Passkey } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { CreatedCredential, WebAuthnBrowser } from '../../core/auth/webauthn';
import { needsPassword, recoveryCodesText, suggestedPasskeyName, svgDataUrl } from './account';
import { AccountPage } from './account.page';
import { HttpErrorResponse } from '@angular/common/http';

const ME: Me = {
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role: 'analyst' }],
};

const PASSKEY: Passkey = { id: 7, name: 'MacBook', authenticator: 'iCloud Keychain', created_at: '2026-11-01T10:00:00Z', last_used_at: null };

const CREATED: CreatedCredential = {
  id: 'cred-1',
  rawId: new Uint8Array([1, 2]).buffer,
  type: 'public-key',
  response: { clientDataJSON: new Uint8Array([3]).buffer, attestationObject: new Uint8Array([4]).buffer, getTransports: () => ['internal'] },
};

describe('helpers da conta', () => {
  it('nome sugerido, códigos e QR como imagem', () => {
    expect(suggestedPasskeyName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('Mac');
    expect(suggestedPasskeyName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)')).toBe('iPhone');
    expect(suggestedPasskeyName('Mozilla/5.0 (Linux; Android 15)')).toBe('Android');
    expect(suggestedPasskeyName('???')).toBe('Meu dispositivo');
    expect(recoveryCodesText(['a', 'b'])).toBe('a\nb');
    expect(svgDataUrl('<svg>ç</svg>')).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(needsPassword(new HttpErrorResponse({ status: 423 }))).toBe(true);
    expect(needsPassword(new HttpErrorResponse({ status: 422 }))).toBe(false);
  });
});

describe('AccountPage', () => {
  let fixture: ComponentFixture<AccountPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let toast: DsToastService;
  let user: ReturnType<typeof signal<Me | null>>;
  const loadSession = vi.fn();
  const webauthn = { supported: vi.fn(() => true), create: vi.fn(), get: vi.fn() };

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
    TestBed.tick();
  }
  const input = (name: string) => el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const type = (name: string, value: string) => {
    input(name).value = value;
    input(name).dispatchEvent(new Event('input'));
  };
  const button = (text: string, root: ParentNode = el) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().startsWith(text));
  const submit = (label: string) => el.querySelector<HTMLFormElement>(`form[aria-label="${label}"]`)!.dispatchEvent(new Event('submit'));

  async function mount(me: Me = ME, passkeys: Passkey[] | null = [PASSKEY]): Promise<void> {
    localStorage.clear();
    user = signal<Me | null>(me);
    loadSession.mockReset().mockImplementation(async () => true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user, status: signal('authenticated'), loadSession } },
        { provide: WebAuthnBrowser, useValue: webauthn },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(DsToastService);
    fixture = TestBed.createComponent(AccountPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    if (passkeys) {
      backend.expectOne('/api/me/passkeys').flush({ data: passkeys });
      await tick();
    }
  }

  afterEach(() => backend.verify());

  it('salva o perfil e recarrega a sessão', async () => {
    webauthn.supported.mockReturnValue(true);
    await mount();
    expect(input('name').value).toBe('Ana Lima');
    type('name', 'Ana Paula Lima');
    await tick();
    submit('Perfil');
    await tick();

    const req = backend.expectOne('/auth/user/profile-information');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ name: 'Ana Paula Lima', email: 'ana@agencia.com' });
    req.flush({});
    await tick();
    expect(loadSession).toHaveBeenCalled();
  });

  it('troca a senha e mostra os erros por campo', async () => {
    await mount();
    type('current_password', 'velha-123');
    type('new_password', 'nova-senha-1');
    type('password_confirmation', 'outra');
    await tick();
    submit('Trocar senha');
    await tick();
    expect(el.textContent).toContain('As senhas não conferem.');
    backend.expectNone('/auth/user/password');

    type('password_confirmation', 'nova-senha-1');
    await tick();
    submit('Trocar senha');
    await tick();
    const req = backend.expectOne('/auth/user/password');
    expect(req.request.body).toEqual({ current_password: 'velha-123', password: 'nova-senha-1', password_confirmation: 'nova-senha-1' });
    req.flush({ message: 'x', errors: { current_password: ['A senha atual não confere.'] } }, { status: 422, statusText: 'Unprocessable' });
    await tick();
    expect(el.textContent).toContain('A senha atual não confere.');
  });

  it('ativa o 2FA pedindo a senha (423), confirma o código e mostra os códigos de recuperação', async () => {
    await mount();
    button('Ativar', el.querySelector('[data-testid="two-factor"]')!)!.click();
    await tick();

    backend.expectOne('/auth/user/two-factor-authentication').flush({ message: 'Password confirmation required.' }, { status: 423, statusText: 'Locked' });
    await tick();
    expect(el.querySelector('[role="dialog"]')?.textContent).toContain('Confirme sua senha');
    type('confirm_password', 'senha-forte-123');
    await tick();
    el.querySelector<HTMLFormElement>('app-password-confirm-dialog form')!.dispatchEvent(new Event('submit'));
    await tick();
    const confirm = backend.expectOne('/auth/user/confirm-password');
    expect(confirm.request.body).toEqual({ password: 'senha-forte-123' });
    confirm.flush('', { status: 201, statusText: 'Created' });
    await tick();

    // A ação é repetida depois da senha.
    backend.expectOne((r) => r.method === 'POST' && r.url === '/auth/user/two-factor-authentication').flush({});
    await tick();
    backend.expectOne('/auth/user/two-factor-qr-code').flush({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' });
    backend.expectOne('/auth/user/two-factor-secret-key').flush({ secretKey: 'JBSWY3DPEHPK3PXP' });
    await tick();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(el.querySelector('[data-testid="secret"]')?.textContent).toBe('JBSWY3DPEHPK3PXP');
    expect(el.querySelector<HTMLImageElement>('img.qr')?.src).toMatch(/^data:image\/svg\+xml;base64,/);

    type('two_factor_code', '123456');
    await tick();
    submit('Confirmar verificação em duas etapas');
    await tick();
    const code = backend.expectOne('/auth/user/confirmed-two-factor-authentication');
    expect(code.request.body).toEqual({ code: '123456' });
    code.flush({});
    await tick();
    user.set({ ...ME, two_factor_enabled: true }); // o loadSession real faria isso
    backend.expectOne('/auth/user/two-factor-recovery-codes').flush(['aaaa-bbbb', 'cccc-dddd']);
    await tick();

    expect(loadSession).toHaveBeenCalled();
    expect(el.querySelector('[data-testid="recovery-codes"]')?.textContent).toContain('cccc-dddd');
    expect(el.querySelector('[data-testid="two-factor"] [role="status"]')?.textContent?.trim()).toBe('Ativa');
  });

  it('código errado fica no campo; desistir da senha não repete a ação', async () => {
    await mount();
    button('Ativar', el.querySelector('[data-testid="two-factor"]')!)!.click();
    await tick();
    backend.expectOne('/auth/user/two-factor-authentication').flush({}, { status: 423, statusText: 'Locked' });
    await tick();
    button('Cancelar', el.querySelector('[role="dialog"]')!)!.click();
    await tick();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    backend.expectNone('/auth/user/two-factor-authentication');
  });

  it('desativa o 2FA com confirmação', async () => {
    await mount({ ...ME, two_factor_enabled: true });
    const card = el.querySelector('[data-testid="two-factor"]')!;
    button('Desativar', card)!.click();
    await tick();
    expect(card.textContent).toContain('A conta fica protegida só pela senha.');
    [...card.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === 'Desativar').at(-1)!.click();
    await tick();
    const req = backend.expectOne('/auth/user/two-factor-authentication');
    expect(req.request.method).toBe('DELETE');
    req.flush({});
    await tick();
    expect(loadSession).toHaveBeenCalled();
  });

  it('lista as passkeys e adiciona uma nova pelo navegador', async () => {
    await mount();
    const card = el.querySelector('[data-testid="passkeys"]')!;
    expect(card.textContent).toContain('MacBook');
    expect(card.textContent).toContain('iCloud Keychain');
    expect(card.textContent).toContain('último uso nunca');

    webauthn.create.mockReset().mockResolvedValue(CREATED);
    type('passkey_name', 'iPhone da Ana');
    await tick();
    submit('Adicionar passkey');
    await tick();

    const options = { challenge: 'AQID', rp: { name: 'localhost', id: 'localhost' }, user: { id: 'BAU', name: 'ana@agencia.com', displayName: 'Ana' }, pubKeyCredParams: [] };
    backend.expectOne('/auth/user/passkeys/options').flush({ options });
    await tick();
    expect(webauthn.create).toHaveBeenCalledWith(options);
    const store = backend.expectOne((r) => r.method === 'POST' && r.url === '/auth/user/passkeys');
    expect(store.request.body).toEqual({
      name: 'iPhone da Ana',
      credential: { id: 'cred-1', rawId: 'AQI', type: 'public-key', response: { clientDataJSON: 'Aw', attestationObject: 'BA', transports: ['internal'] } },
    });
    const success = vi.spyOn(toast, 'success');
    store.flush({}, { status: 201, statusText: 'Created' });
    await tick();
    backend.expectOne('/api/me/passkeys').flush({ data: [PASSKEY, { ...PASSKEY, id: 8, name: 'iPhone da Ana' }] });
    await tick();
    expect(success).toHaveBeenCalledWith('Passkey adicionada', expect.anything());
    expect(card.textContent).toContain('iPhone da Ana');
  });

  it('cancelar a janela do navegador mostra só "Cadastro cancelado"', async () => {
    await mount();
    webauthn.create.mockReset().mockRejectedValue(new DOMException('cancelado', 'NotAllowedError'));
    submit('Adicionar passkey');
    await tick();
    backend.expectOne('/auth/user/passkeys/options').flush({ options: { challenge: 'AQID', rp: { name: 'x' }, user: { id: 'AQ', name: 'a', displayName: 'a' }, pubKeyCredParams: [] } });
    await tick();
    expect(el.querySelector('[data-testid="passkeys"]')?.textContent).toContain('Cadastro cancelado.');
    backend.expectNone('/auth/user/passkeys');
  });

  it('remove a passkey com confirmação', async () => {
    await mount();
    button('Remover', el.querySelector('[data-testid="passkeys"]')!)!.click();
    await tick();
    [...el.querySelectorAll<HTMLButtonElement>('[data-testid="passkeys"] button')].filter((b) => b.textContent?.trim() === 'Remover').at(-1)!.click();
    await tick();
    const req = backend.expectOne('/auth/user/passkeys/7');
    expect(req.request.method).toBe('DELETE');
    req.flush({});
    await tick();
    backend.expectOne('/api/me/passkeys').flush({ data: [] });
    await tick();
    expect(el.querySelector('[data-testid="passkeys"]')?.textContent).toContain('Nenhuma passkey ainda.');
  });

  it('navegador sem suporte: explica e não busca passkeys', async () => {
    webauthn.supported.mockReturnValue(false);
    await mount(ME, null);
    backend.expectNone('/api/me/passkeys');
    expect(el.querySelector('[data-testid="passkey-unsupported"]')?.textContent).toContain('não suporta passkeys');
    webauthn.supported.mockReturnValue(true);
  });
});
