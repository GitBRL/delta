import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiToken, Branding, Me, Role, WebhookEndpoint } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { ApiPage } from './api.page';
import { BrandingPage } from './branding.page';
import { SettingsPage } from './settings.page';
import {
  CONNECT_ENDPOINTS,
  CONNECT_EVENTS,
  brandingDraftFrom,
  cliExample,
  connectBase,
  connectCurlExample,
  eventsText,
  isDevFrontOrigin,
  logoProblem,
  mcpConfig,
  mcpUrl,
  previewBrand,
  tokenState,
  validateBranding,
  webhookState,
} from './settings';

const me = (role: Role): Me => ({
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const BRANDING: Branding = {
  name: 'Agência Norte',
  color: '#0a84ff',
  logo_url: null,
  hide_delta_badge: false,
  display_name: null,
  primary_color: null,
  email_reply_to: null,
  custom_domain: 'relatorios.norte.com.br',
  domain_status: 'pending',
  cname_target: 'links.delta.app',
};

const TOKEN: ApiToken = {
  id: 'k1',
  name: 'BI da agência',
  prefix: 'dlt_ab12cd',
  scopes: ['projects:read'],
  last_used_at: null,
  expires_at: null,
  revoked_at: null,
  active: true,
  created_at: '2026-11-10T10:00:00Z',
};

const HOOK: WebhookEndpoint = {
  id: 'w1',
  url: 'https://crm.norte.com.br/hooks/delta',
  description: 'CRM',
  events: ['report.published'],
  active: true,
  failure_count: 0,
  disabled_at: null,
  created_at: '2026-11-10T10:00:00Z',
};

const SCOPES = { 'projects:read': 'Ler projetos', 'metrics:read': 'Ler métricas' };
const EVENTS = { 'report.published': 'Relatório publicado', 'action.measured': 'Resultado de ação medido' };

describe('helpers de configurações', () => {
  it('valida a marca e monta a prévia com o rascunho', () => {
    const draft = { ...brandingDraftFrom(BRANDING), primary_color: '#FF375F', display_name: ' Norte Digital ' };
    expect(previewBrand(BRANDING, draft, 'Agência Norte', null)).toEqual({
      name: 'Norte Digital',
      color: '#ff375f',
      logo_url: null,
      hide_delta_badge: false,
    });
    expect(previewBrand(BRANDING, { ...draft, primary_color: '#ff3', display_name: '' }, 'Agência Norte', null).color).toBe('#0a84ff');
    expect(validateBranding({ ...draft, primary_color: 'vermelho', custom_domain: 'https://x.com' })).toEqual({
      primary_color: 'Use uma cor no formato #RRGGBB.',
      custom_domain: 'Informe só o domínio, sem http://.',
    });
  });

  it('recusa SVG e arquivos grandes antes de enviar', () => {
    expect(logoProblem({ type: 'image/svg+xml', size: 10 })).toContain('SVG não é aceito');
    expect(logoProblem({ type: 'image/png', size: 3 * 1024 * 1024 })).toContain('2 MB');
    expect(logoProblem({ type: 'image/webp', size: 1000 })).toBeNull();
  });

  it('estados de token e webhook, e eventos legíveis', () => {
    expect(tokenState(TOKEN).label).toBe('Ativo');
    expect(tokenState({ ...TOKEN, expires_at: '2026-01-01T00:00:00Z' }, new Date('2026-11-12')).label).toBe('Expirado');
    expect(tokenState({ ...TOKEN, revoked_at: '2026-11-11T00:00:00Z' }).label).toBe('Revogado');
    expect(webhookState({ ...HOOK, disabled_at: '2026-11-11T00:00:00Z' }).label).toBe('Desativado após falhas');
    expect(webhookState({ ...HOOK, active: false }).label).toBe('Pausado');
    expect(eventsText(['*'], EVENTS)).toBe('Todos os eventos');
    expect(eventsText(['report.published', 'x.y'], EVENTS)).toBe('Relatório publicado · x.y');
  });
});

describe('MCP e CLI (helpers)', () => {
  it('monta o endereço, a configuração do cliente e os comandos da CLI', () => {
    expect(mcpUrl('https://app.agencia.com/')).toBe('https://app.agencia.com/mcp');
    const config = JSON.parse(mcpConfig('https://app.agencia.com/mcp'));
    expect(config).toEqual({
      mcpServers: { delta: { type: 'http', url: 'https://app.agencia.com/mcp', headers: { Authorization: 'Bearer dlt_SEU_TOKEN' } } },
    });
    expect(cliExample('http://localhost:8000')).toContain('delta.mjs login --url http://localhost:8000 --token -');
    expect(isDevFrontOrigin('http://localhost:4300')).toBe(true);
    expect(isDevFrontOrigin('https://app.agencia.com')).toBe(false);
  });
});

describe('Delta Connect (helpers)', () => {
  it('monta a base, lista rotas e eventos e o exemplo de criação', () => {
    expect(connectBase('https://app.agencia.com/')).toBe('https://app.agencia.com/api/connect/v1');
    expect(CONNECT_ENDPOINTS.map((e) => e.path)).toEqual([
      '/customers',
      '/customers/{id}',
      '/customers/{id}/token',
      '/integrations',
      '/customer-integrations/session',
      '/customer',
      '/metrics',
      '/metrics/get-data',
      '/metrics/get-data-async',
    ]);
    expect(CONNECT_ENDPOINTS.filter((e) => e.who === 'customer').map((e) => e.path)).toEqual(['/customer', '/metrics', '/metrics/get-data', '/metrics/get-data-async']);
    expect(CONNECT_EVENTS.map((e) => e.name)).toEqual(['connect.metrics_ready', 'customer_integration.connected']);
    const curl = connectCurlExample('https://app.agencia.com/api/connect/v1');
    expect(curl).toContain('curl -X POST https://app.agencia.com/api/connect/v1/customers');
    expect(curl).toContain('/customer-integrations/session');
    expect(curl).toContain('dct_');
  });
});

describe('configurações (telas)', () => {
  let backend: HttpTestingController;
  let el: HTMLElement;
  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
    TestBed.tick();
  }
  const button = (text: string, root: ParentNode = el) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;
  function type(selector: string, value: string): void {
    const input = el.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function mount<T>(component: Type<T>, role: Role = 'owner'): Promise<ComponentFixture<T>> {
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
    const fixture = TestBed.createComponent(component);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    return fixture;
  }

  afterEach(() => backend.verify());

  describe('Marca', () => {
    async function open(branding: Branding = BRANDING): Promise<void> {
      await mount(BrandingPage);
      backend.expectOne('/api/branding').flush({ data: branding });
      await tick();
    }
    const cover = () => el.querySelector<HTMLElement>('aside.preview app-report-view .cover')!;

    it('prévia ao vivo acompanha nome, cor e selo; salva com PUT', async () => {
      await open();
      expect(cover().querySelector('.agency')?.textContent).toContain('Agência Norte');
      expect(button('Salvar marca').disabled).toBe(true);

      type('input[name="display_name"]', 'Norte Digital');
      type('input[name="primary_color"]', '#FF375F');
      const badge = el.querySelector<HTMLInputElement>('input[name="hide_delta_badge"]')!;
      badge.checked = true;
      badge.dispatchEvent(new Event('change'));
      await tick();

      expect(cover().querySelector('.agency')?.textContent).toContain('Norte Digital');
      expect(cover().style.getPropertyValue('--brand-color')).toBe('#ff375f');
      expect(el.querySelector('[data-testid="badge-preview"]')?.textContent).toContain('Sem o selo');

      button('Salvar marca').click();
      await tick();
      const req = backend.expectOne('/api/branding');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({
        display_name: 'Norte Digital',
        primary_color: '#FF375F',
        hide_delta_badge: true,
        email_reply_to: null,
        custom_domain: 'relatorios.norte.com.br',
      });
      req.flush({ data: { ...BRANDING, name: 'Norte Digital', display_name: 'Norte Digital', color: '#ff375f', primary_color: '#ff375f', hide_delta_badge: true } });
      await tick();
      expect(button('Salvar marca').disabled).toBe(true);
    });

    it('cor inválida não sai do navegador', async () => {
      await open();
      type('input[name="primary_color"]', 'vermelho');
      await tick();
      button('Salvar marca').click();
      await tick();
      expect(el.textContent).toContain('Use uma cor no formato #RRGGBB.');
      backend.expectNone('/api/branding');
    });

    it('envia o logo como arquivo e recusa SVG sem chamar a API', async () => {
      await open();
      const input = el.querySelector<HTMLInputElement>('input[type="file"][name="logo"]')!;
      const choose = (file: File) => {
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change'));
      };

      choose(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
      await tick();
      expect(el.querySelector('.error[role="alert"]')?.textContent).toContain('SVG não é aceito');
      backend.expectNone('/api/branding/logo');

      const png = new File(['png'], 'logo.png', { type: 'image/png' });
      choose(png);
      await tick();
      const req = backend.expectOne('/api/branding/logo');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toBeInstanceOf(FormData);
      expect((req.request.body as FormData).get('logo')).toBe(png);
      req.flush({ data: { ...BRANDING, logo_url: '/api/public/branding/t1/logo?signature=x' } });
      await tick();

      expect(el.querySelector('.logo-box img')?.getAttribute('src')).toContain('/api/public/branding/t1/logo');
      expect(cover().querySelector('img.brand-logo')).not.toBeNull();
      expect(button('Remover')).toBeTruthy();
    });

    it('mostra o CNAME e verifica o domínio', async () => {
      await open();
      expect(el.querySelector('.record')?.textContent).toContain('relatorios.norte.com.br → links.delta.app');
      expect(el.querySelector('[data-testid="domain-status"]')?.textContent?.trim()).toBe('Aguardando DNS');

      button('Verificar').click();
      await tick();
      const req = backend.expectOne('/api/branding/domain/verify');
      expect(req.request.method).toBe('POST');
      req.flush({ data: { ...BRANDING, domain_status: 'verified' }, verification: { ok: true, message: 'Domínio verificado.' } });
      await tick();
      expect(el.querySelector('[data-testid="domain-status"]')?.textContent?.trim()).toBe('Verificado');
      expect(el.querySelector('.result')?.textContent).toContain('Domínio verificado.');
    });

    it('analista vê o aviso e nada é carregado', async () => {
      await mount(BrandingPage, 'analyst');
      expect(el.textContent).toContain('Só donos e administradores');
    });
  });

  describe('API e webhooks', () => {
    async function open(): Promise<void> {
      await mount(ApiPage);
      backend.expectOne('/api/api-tokens').flush({ data: [TOKEN], scopes: SCOPES });
      backend.expectOne('/api/webhooks').flush({ data: [HOOK], events: EVENTS });
      await tick();
    }

    it('mostra a permissão connect com o rótulo vindo do backend', async () => {
      await mount(ApiPage);
      backend.expectOne('/api/api-tokens').flush({ data: [], scopes: { ...SCOPES, connect: 'Delta Connect: criar customers e consultar dados por customer token' } });
      backend.expectOne('/api/webhooks').flush({ data: [], events: EVENTS });
      await tick();
      button('Novo token').click();
      await tick();
      const label = el.querySelector('input[name="scope_connect"]')?.closest('label');
      expect(label?.textContent).toContain('connect');
      expect(label?.textContent).toContain('Delta Connect: criar customers');
    });

    it('cria o token e mostra o valor uma única vez', async () => {
      await open();
      expect(el.querySelector('[data-token="k1"]')?.textContent).toContain('dlt_ab12cd…');
      expect(el.querySelector('[data-testid="api-base"]')?.textContent).toContain('/api/v1');
      const panel = el.querySelector('[data-testid="mcp-panel"]')!;
      expect(panel.textContent).toContain('Usar com assistentes de IA (MCP)');
      expect(panel.textContent).toContain('mcp:tools');
      expect(el.querySelector('[data-testid="mcp-url"]')?.textContent).toMatch(/\/mcp$/);
      expect(el.querySelector('[data-testid="mcp-config"]')?.textContent).toContain('"Authorization": "Bearer dlt_SEU_TOKEN"');
      expect(panel.textContent).toContain('get_performance_summary');
      expect(panel.textContent).toContain('monthly-review');
      expect(el.querySelector('[data-testid="cli-example"]')?.textContent).toContain('delta.mjs summary <projeto>');
      const connect = el.querySelector('[data-testid="connect-panel"]')!;
      expect(connect.textContent).toContain('Delta Connect');
      expect(connect.textContent).toContain('X-Customer-Token');
      expect(el.querySelector('[data-testid="connect-base"]')?.textContent).toMatch(/\/api\/connect\/v1$/);
      expect(connect.querySelectorAll('[data-testid="connect-endpoints"] li').length).toBe(9);
      expect(connect.textContent).toContain('connect.metrics_ready');
      expect(connect.textContent).toContain('customer_integration.connected');
      expect(el.querySelector('[data-testid="connect-example"]')?.textContent).toContain('/customer-integrations/session');

      button('Novo token').click();
      await tick();
      button('Criar token').click(); // vazio
      await tick();
      expect(el.textContent).toContain('Dê um nome ao token.');
      expect(el.textContent).toContain('Escolha ao menos uma permissão.');

      type('input[name="token_name"]', 'Planilha do financeiro');
      const scope = el.querySelector<HTMLInputElement>('input[name="scope_metrics:read"]')!;
      scope.click();
      const expiry = el.querySelector<HTMLSelectElement>('select[name="token_expiry"]')!;
      expiry.value = '90';
      expiry.dispatchEvent(new Event('change'));
      await tick();
      button('Criar token').click();
      await tick();

      const req = backend.expectOne('/api/api-tokens');
      expect(req.request.body).toEqual({ name: 'Planilha do financeiro', scopes: ['metrics:read'], expires_in_days: 90 });
      req.flush({ data: { ...TOKEN, id: 'k2', name: 'Planilha do financeiro', prefix: 'dlt_zz99yy' }, token: 'dlt_zz99yy' + 'x'.repeat(36) }, { status: 201, statusText: 'Created' });
      await tick();

      const once = el.querySelector('[data-testid="token-once"]')!;
      expect(once.textContent).toContain('dlt_zz99yy' + 'x'.repeat(36));
      expect(el.querySelector('[data-token="k2"]')?.textContent).not.toContain('x'.repeat(36));

      button('Já copiei').click();
      await tick();
      expect(el.querySelector('[data-testid="token-once"]')).toBeNull();
      expect(el.textContent).not.toContain('x'.repeat(36));
    });

    it('revoga com confirmação', async () => {
      await open();
      const item = el.querySelector('[data-token="k1"]')!;
      button('Revogar', item).click();
      await tick();
      expect(item.textContent).toContain('param na hora');
      button('Revogar', item).click();
      await tick();
      const req = backend.expectOne('/api/api-tokens/k1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
      await tick();
      backend.expectOne('/api/api-tokens').flush({ data: [{ ...TOKEN, revoked_at: '2026-11-12T10:00:00Z', active: false }], scopes: SCOPES });
      await tick();
      expect(el.querySelector('[data-token="k1"] .chip')?.textContent).toContain('Revogado');
    });

    it('cria webhook (segredo uma vez) e lista as entregas', async () => {
      await open();
      button('Novo webhook').click();
      await tick();
      type('input[name="hook_url"]', 'https://n8n.norte.com.br/webhook/delta');
      el.querySelector<HTMLInputElement>('input[name="event_all"]')!.click(); // tira "todos"
      await tick();
      el.querySelector<HTMLInputElement>('input[name="event_action.measured"]')!.click();
      await tick();
      button('Criar webhook').click();
      await tick();

      const req = backend.expectOne((r) => r.url === '/api/webhooks' && r.method === 'POST');
      expect(req.request.body).toEqual({
        url: 'https://n8n.norte.com.br/webhook/delta',
        description: null,
        events: ['action.measured'],
        active: true,
      });
      req.flush({ data: { ...HOOK, id: 'w2' }, secret: 'whsec_segredo123' }, { status: 201, statusText: 'Created' });
      await tick();
      backend.expectOne('/api/webhooks').flush({ data: [HOOK, { ...HOOK, id: 'w2', url: 'https://n8n.norte.com.br/webhook/delta', events: ['action.measured'] }], events: EVENTS });
      await tick();
      expect(el.querySelector('[data-testid="secret-once"]')?.textContent).toContain('whsec_segredo123');
      expect(el.querySelector('[data-webhook="w2"]')?.textContent).toContain('Resultado de ação medido');

      const hook = el.querySelector('[data-webhook="w1"]')!;
      button('Entregas', hook).click();
      await tick();
      backend.expectOne('/api/webhooks/w1/deliveries').flush({
        data: [
          { id: 'd1', event: 'ping', status: 'delivered', attempts: 1, last_status_code: 200, last_error: null, delivered_at: '2026-11-12T10:00:00Z', created_at: '2026-11-12T10:00:00Z' },
          { id: 'd2', event: 'report.published', status: 'failed', attempts: 8, last_status_code: 500, last_error: null, delivered_at: null, created_at: '2026-11-11T10:00:00Z' },
        ],
      });
      await tick();
      const rows = hook.querySelectorAll('table.deliveries tbody tr');
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain('Entregue');
      expect(rows[1].getAttribute('data-status')).toBe('failed');
      expect(rows[1].textContent).toContain('Falhou');

      button('Enviar teste', hook).click();
      await tick();
      expect(backend.expectOne('/api/webhooks/w1/test').request.method).toBe('POST');
    });
  });

  describe('hub', () => {
    it('dono vê os atalhos; cliente vê o aviso', async () => {
      await mount(SettingsPage);
      const links = [...el.querySelectorAll<HTMLAnchorElement>('nav a.card')].map((a) => a.getAttribute('href'));
      expect(links).toEqual([
        '/equipe',
        '/configuracoes/marca',
        '/integracoes/apps',
        '/integracoes/whatsapp',
        '/configuracoes/ia',
        '/configuracoes/importar',
        '/configuracoes/api',
        '/configuracoes/plano',
      ]);
    });

    it('cliente não vê os atalhos', async () => {
      await mount(SettingsPage, 'client');
      expect(el.querySelectorAll('nav a.card')).toHaveLength(0);
      expect(el.textContent).toContain('Só donos e administradores');
    });
  });
});
