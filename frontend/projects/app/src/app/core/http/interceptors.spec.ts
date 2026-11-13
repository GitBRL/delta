import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { TenantService } from '../tenant/tenant.service';
import { credentialsInterceptor, errorInterceptor, tenantInterceptor } from './interceptors';

const TENANT = '0192f0c6-7a1e-7c3b-9d1e-0a1b2c3d4e5f';

describe('interceptors', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  const currentId = signal<string | null>(TENANT);

  beforeEach(() => {
    currentId.set(TENANT);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([credentialsInterceptor, tenantInterceptor, errorInterceptor])),
        provideHttpClientTesting(),
        { provide: TenantService, useValue: { currentId } },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('injeta X-Tenant-Id e credenciais em /api/*', () => {
    http.get('/api/projects').subscribe();
    const req = backend.expectOne('/api/projects');
    expect(req.request.headers.get('X-Tenant-Id')).toBe(TENANT);
    expect(req.request.withCredentials).toBe(true);
    req.flush({ data: [] });
  });

  it('não envia X-Tenant-Id para /auth/* (mas envia credenciais)', () => {
    http.post('/auth/login', {}).subscribe();
    const req = backend.expectOne('/auth/login');
    expect(req.request.headers.has('X-Tenant-Id')).toBe(false);
    expect(req.request.withCredentials).toBe(true);
    req.flush({ two_factor: false });
  });

  it('não sobrescreve um X-Tenant-Id explícito', () => {
    http.get('/api/projects', { headers: { 'X-Tenant-Id': 'outro' } }).subscribe();
    const req = backend.expectOne('/api/projects');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('outro');
    req.flush({ data: [] });
  });

  it('sem agência selecionada, não envia o header', () => {
    currentId.set(null);
    http.get('/api/projects').subscribe();
    const req = backend.expectOne('/api/projects');
    expect(req.request.headers.has('X-Tenant-Id')).toBe(false);
    req.flush({ data: [] });
  });

  it('não marca credenciais em URLs externas', () => {
    http.get('https://example.com/x').subscribe();
    const req = backend.expectOne('https://example.com/x');
    expect(req.request.withCredentials).toBe(false);
    expect(req.request.headers.has('X-Tenant-Id')).toBe(false);
    req.flush({});
  });

  it('401 em /api/* limpa a sessão e manda para o login', async () => {
    const auth = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    const clear = vi.spyOn(auth, 'clear');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const pending = firstValueFrom(http.get('/api/projects')).catch((e: unknown) => e);
    backend.expectOne('/api/projects').flush({ message: 'Unauthenticated.' }, { status: 401, statusText: 'Unauthorized' });
    await pending;

    expect(clear).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/login'], expect.objectContaining({ queryParams: expect.any(Object) }));
  });

  it('401 em /api/me não redireciona (é a sondagem de sessão)', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');

    const pending = firstValueFrom(http.get('/api/me')).catch((e: unknown) => e);
    backend.expectOne('/api/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await pending;

    expect(navigate).not.toHaveBeenCalled();
  });

  it('link público: sem X-Tenant-Id, e o 401 (senha) fica com a tela', async () => {
    const auth = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    const clear = vi.spyOn(auth, 'clear');
    const navigate = vi.spyOn(router, 'navigate');

    const pending = firstValueFrom(http.get('/api/public/reports/abc')).catch((e: unknown) => e);
    const req = backend.expectOne('/api/public/reports/abc');
    expect(req.request.headers.has('X-Tenant-Id')).toBe(false);
    req.flush({ requires_password: true, title: 'R', agency: 'A' }, { status: 401, statusText: 'Unauthorized' });
    await pending;

    expect(clear).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('403 mostra "Sem acesso", exceto no convite (a tela explica qual e-mail usar)', async () => {
    const error = vi.spyOn(TestBed.inject(DsToastService), 'error');

    const forbidden = firstValueFrom(http.get('/api/projects')).catch((e: unknown) => e);
    backend.expectOne('/api/projects').flush({}, { status: 403, statusText: 'Forbidden' });
    await forbidden;
    expect(error).toHaveBeenCalledTimes(1);

    const invite = firstValueFrom(http.post('/api/invitations/abc/accept', {})).catch((e: unknown) => e);
    backend.expectOne('/api/invitations/abc/accept').flush({ message: 'Este convite é para outro e-mail.' }, { status: 403, statusText: 'Forbidden' });
    await invite;
    expect(error).toHaveBeenCalledTimes(1);
  });
});
