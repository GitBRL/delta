import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { AiStatus, Me, Role } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { tenantInterceptor } from '../../core/http/interceptors';
import { AiSettingsPage } from './ai.page';

const STATUS: AiStatus = { enabled: true, configured: true, source: 'agency', budget: 2_000_000, used_this_month: 1_700_000 };

describe('AiSettingsPage', () => {
  let fixture: ComponentFixture<AiSettingsPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let toast: DsToastService;
  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
  }
  const me = (role: Role): Me => ({
    id: 'u1',
    name: 'Ana Lima',
    email: 'ana@agencia.com',
    two_factor_enabled: false,
    tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
  });
  const input = (name: string) => el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const type = (name: string, value: string) => {
    input(name).value = value;
    input(name).dispatchEvent(new Event('input'));
  };
  const button = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().startsWith(text));

  async function mount(role: Role = 'owner', status: AiStatus | null = STATUS): Promise<void> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([tenantInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(DsToastService);
    fixture = TestBed.createComponent(AiSettingsPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    if (status) {
      backend.expectOne('/api/ai').flush({ data: status });
      await tick();
      await tick(); // ngModel grava o valor no campo num microtask
    }
  }

  afterEach(() => backend.verify());

  it('mostra a origem da chave (nunca a chave), o estado e o uso do mês', async () => {
    await mount();

    expect(el.textContent).toContain('Claude, da Anthropic');
    expect(el.textContent).toContain('As respostas são sugestões');
    expect(el.querySelector('[data-testid="key-source"]')?.textContent).toContain('Chave da agência cadastrada');
    expect(input('api_key').type).toBe('password');
    expect(input('api_key').value).toBe('');
    expect(input('enabled').checked).toBe(true);
    expect(input('monthly_token_budget').value).toBe('2000000');

    const bar = el.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('85');
    expect(bar.getAttribute('data-tone')).toBe('warn');
    expect(el.querySelector('[data-testid="usage"]')?.textContent).toContain('1.700.000 de 2.000.000 tokens (85%)');
  });

  it('salva sem mandar a chave quando ela fica em branco', async () => {
    await mount();
    const success = vi.spyOn(toast, 'success');

    type('monthly_token_budget', '3.000.000');
    input('enabled').click();
    await tick();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await tick();

    const req = backend.expectOne((r) => r.method === 'PUT' && r.url === '/api/ai');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    expect(req.request.body).toEqual({ enabled: false, monthly_token_budget: 3_000_000 });
    req.flush({ data: { ...STATUS, enabled: false, budget: 3_000_000 } });
    await tick();

    expect(success).toHaveBeenCalledWith('Copiloto de IA salvo', { message: undefined });
    expect(el.querySelector('.chip')?.textContent).toContain('Desligado');
    expect(button('Salvar')?.disabled).toBe(true); // nada pendente
  });

  it('troca a chave: valida antes, envia uma vez e limpa o campo', async () => {
    await mount('admin', { ...STATUS, configured: false, source: null, used_this_month: 0 });
    expect(el.querySelector('[data-testid="key-source"]')?.textContent).toContain('Nenhuma chave cadastrada');
    expect(button('Remover a chave')).toBeUndefined();

    type('api_key', 'curta');
    await tick();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await tick();
    backend.expectNone('/api/ai');
    expect(el.textContent).toContain('A chave parece incompleta');

    type('api_key', 'sk-ant-api03-abcdefghijklmnop');
    await tick();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await tick();
    const req = backend.expectOne((r) => r.method === 'PUT');
    expect(req.request.body).toEqual({ api_key: 'sk-ant-api03-abcdefghijklmnop', enabled: true, monthly_token_budget: 2_000_000 });
    req.flush({ data: { ...STATUS, used_this_month: 0 } });
    await tick();
    await tick();

    expect(input('api_key').value).toBe('');
    expect(el.querySelector('[data-testid="key-source"]')?.textContent).toContain('Chave da agência cadastrada');
  });

  it('remove a chave só depois de confirmar', async () => {
    await mount();

    button('Remover a chave')!.click();
    await tick();
    backend.expectNone('/api/ai/key');
    expect(el.textContent).toContain('O copiloto para até uma nova chave ser cadastrada');

    button('Remover chave')!.click();
    await tick();
    const req = backend.expectOne('/api/ai/key');
    expect(req.request.method).toBe('DELETE');
    req.flush({ data: { ...STATUS, configured: true, source: 'server' } });
    await tick();

    expect(el.querySelector('[data-testid="key-source"]')?.textContent).toContain('Usando a chave do servidor');
  });

  it('analista vê o aviso (a chamada de status é da equipe, mas a tela é de dono/admin)', async () => {
    await mount('analyst', null);
    backend.expectOne('/api/ai').flush({ data: STATUS });
    await tick();
    expect(el.textContent).toContain('Só donos e administradores');
    expect(el.querySelector('form')).toBeNull();
  });
});
