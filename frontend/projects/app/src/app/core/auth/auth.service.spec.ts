import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Me } from '../api/api.types';
import { AuthService } from './auth.service';

const ME: Me = {
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'agencia-norte', role: 'owner' }],
};

/** Deixa as promessas encadeadas avançarem até a próxima requisição. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AuthService', () => {
  let auth: AuthService;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('login: busca CSRF, autentica e carrega /api/me', async () => {
    const result = auth.login({ email: 'ana@agencia.com', password: 'segredo123', remember: true });

    backend.expectOne({ method: 'GET', url: '/sanctum/csrf-cookie' }).flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    const login = backend.expectOne({ method: 'POST', url: '/auth/login' });
    expect(login.request.body).toEqual({ email: 'ana@agencia.com', password: 'segredo123', remember: true });
    login.flush({ two_factor: false });
    await tick();
    backend.expectOne('/api/me').flush({ data: ME });

    expect(await result).toBe('authenticated');
    expect(auth.status()).toBe('authenticated');
    expect(auth.user()?.tenants[0].name).toBe('Agência Norte');
  });

  it('login com 2FA pendente não carrega a sessão', async () => {
    const result = auth.login({ email: 'ana@agencia.com', password: 'segredo123', remember: false });
    backend.expectOne('/sanctum/csrf-cookie').flush(null);
    await tick();
    backend.expectOne('/auth/login').flush({ two_factor: true });

    expect(await result).toBe('two-factor');
    backend.expectNone('/api/me');
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('ensureSession: 401 em /api/me vira visitante, sem lançar erro', async () => {
    const result = auth.ensureSession();
    backend.expectOne('/api/me').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(await result).toBe(false);
    expect(auth.status()).toBe('guest');
  });

  it('ensureSession: chamadas simultâneas fazem uma única requisição', async () => {
    const a = auth.ensureSession();
    const b = auth.ensureSession();
    backend.expectOne('/api/me').flush({ data: ME });

    expect(await a).toBe(true);
    expect(await b).toBe(true);
  });

  it('logout limpa o estado mesmo se o servidor falhar', async () => {
    const result = auth.logout();
    backend.expectOne('/auth/logout').flush({}, { status: 500, statusText: 'Server Error' });
    await expect(result).rejects.toBeTruthy();
    expect(auth.status()).toBe('guest');
    expect(auth.user()).toBeNull();
  });
});
