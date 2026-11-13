import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Me, WhatsAppSettings } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { validateWhatsApp, whatsappBody, whatsappDraftFrom } from './whatsapp';
import { WhatsAppPage } from './whatsapp.page';

const me = (role: string): Me => ({
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const SANDBOX: WhatsAppSettings = {
  mode: 'sandbox', configured: false, status: 'sandbox', phone_number_id: null, waba_id: null, display_phone: null,
  template_name: null, template_language: 'pt_BR', has_access_token: false, has_app_secret: false, verify_token: null,
  webhook_url: 'http://localhost:8000/api/webhooks/whatsapp',
  template_example: 'Olá, {{1}}! O relatório de {{2}} referente a {{3}} está pronto.',
  verified_at: null, verification_error: null, updated_by: null, updated_at: null,
};

describe('helpers do WhatsApp', () => {
  it('demonstração só manda o modo; segredos em branco ficam de fora', () => {
    const draft = whatsappDraftFrom(SANDBOX);
    expect(whatsappBody(draft)).toEqual({ mode: 'sandbox' });
    expect(whatsappBody({ ...draft, mode: 'cloud', phone_number_id: ' 109876543210987 ', access_token: '  ' })).toEqual({
      mode: 'cloud', phone_number_id: '109876543210987', waba_id: null, template_name: 'relatorio_periodico', template_language: 'pt_BR',
    });
  });

  it('exige token e segredo só na primeira vez', () => {
    const draft = { ...whatsappDraftFrom(SANDBOX), mode: 'cloud' as const, phone_number_id: '123' };
    expect(Object.keys(validateWhatsApp(draft, SANDBOX))).toEqual(['phone_number_id', 'access_token', 'app_secret']);
    expect(validateWhatsApp({ ...draft, phone_number_id: '109876543210987' }, { ...SANDBOX, has_access_token: true, has_app_secret: true })).toEqual({});
  });
});

describe('WhatsAppPage', () => {
  let fixture: ComponentFixture<WhatsAppPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }
  function create(role: string): void {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WhatsAppPage);
    el = fixture.nativeElement as HTMLElement;
  }
  const type = (name: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(`[name="${name}"] input, input[name="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text))!;

  afterEach(() => backend.verify());

  it('analista vê o aviso e a API não é chamada', async () => {
    create('analyst');
    await tick();
    expect(el.textContent).toContain('Só donos e administradores');
    backend.expectNone('/api/whatsapp');
  });

  it('liga o número oficial: valida, envia sem segredos em branco e mostra a verificação', async () => {
    create('owner');
    await tick();
    backend.expectOne('/api/whatsapp').flush({ data: SANDBOX, verification: null });
    await tick();
    expect(el.querySelector('[data-testid="wa-status"]')?.textContent).toContain('Demonstração');

    el.querySelector<HTMLInputElement>('input[value="cloud"]')!.click();
    await tick();
    button('Salvar e verificar').click();
    await tick();
    expect(el.textContent).toContain('Informe o token de acesso permanente.');
    backend.expectNone('/api/whatsapp');

    type('phone_number_id', '109876543210987');
    type('access_token', 'EAAGxxxxxxxxxxxxxxxxxxxxxxxx');
    type('app_secret', '0123456789abcdef0123456789abcdef');
    await tick();
    button('Salvar e verificar').click();
    await tick();

    const req = backend.expectOne((r) => r.method === 'PUT' && r.url === '/api/whatsapp');
    expect(req.request.body).toEqual({
      mode: 'cloud', phone_number_id: '109876543210987', waba_id: null, template_name: 'relatorio_periodico', template_language: 'pt_BR',
      access_token: 'EAAGxxxxxxxxxxxxxxxxxxxxxxxx', app_secret: '0123456789abcdef0123456789abcdef',
    });
    req.flush({
      data: { ...SANDBOX, mode: 'cloud', configured: true, status: 'verified', phone_number_id: '109876543210987', display_phone: '+55 11 4000-0000', has_access_token: true, has_app_secret: true, verify_token: 'abcDEF123', template_name: 'relatorio_periodico' },
      verification: { ok: true, message: 'A Meta confirmou o número +55 11 4000-0000.', display_phone: '+55 11 4000-0000' },
    });
    await tick();
    await tick(); // o ngModel grava o campo limpo num microtask depois da detecção

    expect(el.querySelector('[data-testid="wa-status"]')?.textContent).toContain('Número oficial verificado');
    expect(el.textContent).toContain('A Meta confirmou o número');
    expect(el.textContent).toContain('abcDEF123');
    expect(el.textContent).toContain('/api/webhooks/whatsapp');
    expect(el.querySelector<HTMLInputElement>('[name="access_token"] input, input[name="access_token"]')!.value).toBe('');
  });
});
