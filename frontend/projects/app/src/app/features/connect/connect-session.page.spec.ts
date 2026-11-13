import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PublicConnectSession } from '../../core/api/api.types';
import { OAuthOutcome } from '../../core/oauth/oauth-flow';
import { OAuthFlow, OAuthService, OAuthSessionStartRequest } from '../../core/oauth/oauth.service';
import { ConnectSessionPage, POPUP_REQUIRED_MESSAGE, primaryMode, safeReturnUrl } from './connect-session.page';

const TOKEN = 'k'.repeat(48);
const URL_ = `/api/public/connect/${TOKEN}`;

const DATA: PublicConnectSession = {
  brand: { name: 'SaaS Aurora', color: '#ff375f', logo_url: null, hide_delta_badge: false },
  customer: { name: 'Loja Boreal' },
  expired: false,
  expires_at: '2026-11-13T00:30:00Z',
  return_url: 'https://app.saas.test/voltar',
  platforms: [
    { key: 'meta_ads', name: 'Meta Ads', category: 'ads', modes: ['sandbox', 'live'], connected_accounts: [] },
    { key: 'ga4', name: 'Google Analytics 4', category: 'analytics', modes: ['sandbox'], connected_accounts: ['Site da Loja'] },
  ],
};

/** OAuth falso: guarda os pedidos e deixa o teste decidir o desfecho. */
class FakeOAuth {
  requests: OAuthSessionStartRequest[] = [];
  blocked = false;
  disposed = 0;
  private resolve: ((o: OAuthOutcome) => void) | null = null;

  startSession(request: OAuthSessionStartRequest): OAuthFlow | null {
    this.requests.push(request);
    if (this.blocked) return null;
    const result = new Promise<OAuthOutcome>((r) => (this.resolve = r));
    return { flow: 'flow_0123456789abcdef', via: 'popup', result, cancel: () => undefined, dispose: () => this.disposed++ };
  }
  finish(outcome: OAuthOutcome): void {
    this.resolve?.(outcome);
  }
}

describe('ConnectSessionPage', () => {
  let fixture: ComponentFixture<ConnectSessionPage>;
  let backend: HttpTestingController;
  let oauth: FakeOAuth;
  let el: HTMLElement;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
    TestBed.tick();
  }
  const button = (root: ParentNode, text: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
  const card = (key: string) => el.querySelector(`[data-testid="platform-${key}"]`) as HTMLElement;

  async function mount(response: PublicConnectSession | { status: number }): Promise<void> {
    oauth = new FakeOAuth();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: OAuthService, useValue: oauth }],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ConnectSessionPage);
    fixture.componentRef.setInput('token', TOKEN);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    const req = backend.expectOne(URL_);
    expect(req.request.headers.has('X-Tenant-Id')).toBe(false);
    if ('status' in response) req.flush({ message: 'x' }, { status: response.status, statusText: 'x' });
    else req.flush({ data: response });
    await tick();
  }

  afterEach(() => {
    backend.verify();
    document.documentElement.removeAttribute('data-theme');
  });

  it('mostra a marca, o cliente e as plataformas liberadas com as contas já conectadas', async () => {
    await mount(DATA);
    expect(el.querySelector<HTMLElement>('.page')?.style.getPropertyValue('--ds-accent')).toBe('#ff375f');
    expect(el.querySelector('.agency')?.textContent).toContain('SaaS Aurora');
    expect(el.querySelector('h1')?.textContent).toContain('Conecte as contas de Loja Boreal');
    expect(card('meta_ads').textContent).toContain('Meta Ads');
    expect(card('meta_ads').querySelector('[data-testid="connected"]')).toBeNull();
    expect(card('ga4').querySelector('[data-testid="connected"]')?.textContent).toContain('Conectado: Site da Loja');
    expect(el.textContent).toContain('Feito com Delta');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('usa o modo real quando existe e oferece a demonstração; só demonstração diz isso no botão', async () => {
    await mount(DATA);
    expect(button(card('meta_ads'), 'Conectar')).toBeTruthy();
    expect(button(card('meta_ads'), 'Usar demonstração')).toBeTruthy();
    expect(button(card('ga4'), 'Conectar (demonstração)')).toBeTruthy();

    button(card('meta_ads'), 'Conectar')!.click();
    expect(oauth.requests).toEqual([{ provider: 'meta_ads', session: TOKEN, mode: 'live' }]);
  });

  it('em sucesso recarrega os dados e mostra a conta conectada', async () => {
    await mount(DATA);
    button(card('ga4'), 'Conectar (demonstração)')!.click();
    expect(oauth.requests[0]).toEqual({ provider: 'ga4', session: TOKEN, mode: 'sandbox' });
    await tick();
    expect(button(card('meta_ads'), 'Conectar')?.disabled).toBe(true); // um login por vez

    oauth.finish({ status: 'success', provider: 'ga4', connectionId: 'c1' });
    await tick();
    backend.expectOne(URL_).flush({ data: { ...DATA, platforms: [DATA.platforms[0], { ...DATA.platforms[1], connected_accounts: ['Site da Loja', 'Blog'] }] } });
    await tick();

    expect(card('ga4').textContent).toContain('Conectado: Site da Loja, Blog');
    expect(el.querySelector('[data-testid="notice"]')?.textContent).toContain('Google Analytics 4 conectado.');
    expect(button(card('meta_ads'), 'Conectar')?.disabled).toBe(false);
  });

  it('em erro mostra a mensagem que veio da plataforma', async () => {
    await mount(DATA);
    button(card('meta_ads'), 'Conectar')!.click();
    oauth.finish({ status: 'error', provider: 'meta_ads', message: 'Esta plataforma não foi liberada neste link de conexão.' });
    await tick();
    expect(el.querySelector('[data-testid="notice"]')?.textContent).toContain('não foi liberada neste link');
  });

  it('com o pop-up bloqueado pede para permitir pop-ups (não há volta pelo modo redirect)', async () => {
    await mount(DATA);
    oauth.blocked = true;
    button(card('meta_ads'), 'Conectar')!.click();
    await tick();
    expect(el.querySelector('[data-testid="popup-blocked"]')?.textContent).toContain(POPUP_REQUIRED_MESSAGE);
    expect(button(card('meta_ads'), 'Conectar')?.disabled).toBe(false);
  });

  it('"Concluir" volta para o SaaS; sem endereço de volta, agradece', async () => {
    await mount(DATA);
    const link = el.querySelector<HTMLAnchorElement>('a[data-testid="finish"]');
    expect(link?.getAttribute('href')).toBe('https://app.saas.test/voltar');
    fixture.destroy();
    backend.verify();
    TestBed.resetTestingModule();

    await mount({ ...DATA, return_url: null });
    el.querySelector<HTMLButtonElement>('button[data-testid="finish"]')!.click();
    await tick();
    expect(el.querySelector('[data-testid="finished"]')?.textContent).toContain('Pronto! Você já pode fechar esta janela.');
    expect(el.querySelector('[data-testid="platform-meta_ads"]')).toBeNull();
  });

  it('link vencido não oferece conexão', async () => {
    await mount({ ...DATA, expired: true });
    expect(el.querySelector('[data-testid="expired"]')?.textContent).toContain('Este link expirou. Peça um novo a quem enviou.');
    expect(el.querySelector('[data-testid="platform-meta_ads"]')).toBeNull();
  });

  it('token inválido tem estado próprio', async () => {
    await mount({ status: 404 });
    expect(el.querySelector('[data-testid="missing"]')?.textContent).toContain('Link de conexão inválido');
  });

  it('para de escutar o pop-up ao sair da página', async () => {
    await mount(DATA);
    button(card('meta_ads'), 'Conectar')!.click();
    fixture.destroy();
    expect(oauth.disposed).toBe(1);
  });
});

describe('connect-session: funções puras', () => {
  it('escolhe o modo principal do botão', () => {
    expect(primaryMode({ ...DATA.platforms[0], modes: ['sandbox', 'live'] })).toBe('live');
    expect(primaryMode({ ...DATA.platforms[0], modes: ['sandbox'] })).toBe('sandbox');
    expect(primaryMode({ ...DATA.platforms[0], modes: [] })).toBeNull();
  });

  it('só aceita endereço de volta http(s)', () => {
    expect(safeReturnUrl('https://app.saas.test/voltar?x=1')).toBe('https://app.saas.test/voltar?x=1');
    expect(safeReturnUrl('javascript:alert(1)')).toBeNull();
    expect(safeReturnUrl('não é url')).toBeNull();
    expect(safeReturnUrl(null)).toBeNull();
  });
});
