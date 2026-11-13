import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { Connection, Me, Provider } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { OAuthOutcome } from '../../core/oauth/oauth-flow';
import { OAuthFlow, OAuthService, OAuthStartRequest } from '../../core/oauth/oauth.service';
import { hasSyncing, upsertConnection } from './integration-labels';
import { IntegrationsPage, LIVE_FALLBACK_NOTE, SYNC_POLL_MS } from './integrations.page';

const me = (role: string): Me => ({
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const PROVIDERS: Provider[] = [
  {
    key: 'meta_ads',
    name: 'Meta Ads',
    category: 'ads',
    available_modes: ['sandbox'],
    live_note: 'Credenciais do app ainda não configuradas.',
    metrics_count: 16,
    featured_metrics: ['meta_ads:spend'],
    app_vendor: 'meta',
  },
  {
    key: 'ga4',
    name: 'Google Analytics 4',
    category: 'analytics',
    available_modes: ['sandbox', 'live'],
    live_note: 'Login real disponível; a coleta de dados reais desta plataforma ainda está em desenvolvimento.',
    metrics_count: 12,
    featured_metrics: ['ga4:sessions'],
    app_vendor: 'google',
  },
];

const connection = (status: Connection['status'], id = 'c1'): Connection => ({
  id,
  provider: 'meta_ads',
  mode: 'sandbox',
  status,
  label: 'Demonstração',
  last_synced_at: null,
  last_error: null,
  accounts: [
    { id: 'a1', provider: 'meta_ads', name: 'Padaria Aurora', kind: 'ad_account', currency: 'BRL', external_id: 'act_1' },
  ],
});

/** Serviço OAuth controlável: o teste decide quando e como cada fluxo termina. */
class FakeOAuth {
  readonly starts: OAuthStartRequest[] = [];
  via: 'popup' | 'redirect' = 'popup';
  cancel = vi.fn();
  dispose = vi.fn();
  private resolveCurrent: ((o: OAuthOutcome) => void) | null = null;

  start(request: OAuthStartRequest): OAuthFlow {
    this.starts.push(request);
    const result = new Promise<OAuthOutcome>((resolve) => (this.resolveCurrent = resolve));
    return { flow: `flow_${this.starts.length}_xxxxxxxxxxxx`, via: this.via, result, cancel: this.cancel, dispose: this.dispose };
  }

  finish(outcome: OAuthOutcome): void {
    this.resolveCurrent?.(outcome);
  }
}

describe('helpers de integrações', () => {
  it('detecta conexões sincronizando', () => {
    expect(hasSyncing([connection('active'), connection('syncing', 'c2')])).toBe(true);
    expect(hasSyncing([connection('active'), connection('error', 'c2')])).toBe(false);
  });

  it('substitui pelo id ou acrescenta no topo', () => {
    const list = [connection('syncing', 'c1'), connection('active', 'c2')];
    expect(upsertConnection(list, connection('active', 'c1')).map((c) => c.status)).toEqual(['active', 'active']);
    expect(upsertConnection(list, connection('syncing', 'c3')).map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
  });
});

describe('IntegrationsPage', () => {
  let fixture: ComponentFixture<IntegrationsPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let oauth: FakeOAuth;
  let toast: DsToastService;
  let providersTenant: string | null;

  /** Deixa respostas e continuações async (microtasks) acontecerem. */
  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  /** Roda efeitos e detecção de mudanças (dispara requisições); não espera requisições. */
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }
  /** Espera estabilizar. Só SEM requisições pendentes (elas contam como tarefa pendente do app). */
  async function settle(): Promise<void> {
    await tick();
    await fixture.whenStable();
  }
  const button = (text: string, scope: ParentNode = el) =>
    [...scope.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  const card = (name: string) =>
    [...el.querySelectorAll('ds-glass-card')].find((c) => c.querySelector('h3')?.textContent?.includes(name)) as HTMLElement;

  async function setup(options: { role?: string; query?: Record<string, string> } = {}): Promise<void> {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    localStorage.clear();
    oauth = new FakeOAuth();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(options.role ?? 'owner')), status: signal('authenticated') } },
        { provide: OAuthService, useValue: oauth },
        ...(options.query
          ? [{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(options.query) } } }]
          : []),
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(DsToastService);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(IntegrationsPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    const providers = backend.expectOne('/api/providers');
    providersTenant = providers.request.headers.get('X-Tenant-Id');
    providers.flush({ data: PROVIDERS });
  }

  afterEach(() => {
    vi.useRealTimers();
    backend.verify();
  });

  it('lista os canais; a conexão real fica bloqueada com a observação do backend', async () => {
    await setup();
    backend.expectOne('/api/connections').flush({ data: [] });
    await settle();

    expect(el.textContent).toContain('Mídia paga · 16 métricas');
    const locked = button('Conectar conta real', card('Meta Ads'));
    expect(locked?.getAttribute('aria-disabled')).toBe('true');
    expect(locked?.getAttribute('title')).toBe('Credenciais do app ainda não configuradas.');

    const live = button('Conectar conta real', card('Google Analytics 4'));
    expect(live?.getAttribute('aria-disabled')).toBeNull();
    expect(card('Google Analytics 4').textContent).toContain('coleta de dados reais desta plataforma ainda está em desenvolvimento');
  });

  it('pede os canais com a agência no header (o login real depende dos apps da agência)', async () => {
    await setup();
    backend.expectOne('/api/connections').flush({ data: [] });
    await settle();

    expect(providersTenant).toBe('t1');
  });

  it('dono/admin: atalho para os apps e o botão bloqueado leva ao app que falta', async () => {
    await setup({ role: 'admin' });
    backend.expectOne('/api/connections').flush({ data: [] });
    await settle();
    const navigate = TestBed.inject(Router).navigate as unknown as ReturnType<typeof vi.fn>;
    const info = vi.spyOn(toast, 'info');

    const shortcut = [...el.querySelectorAll('a')].find((a) => a.textContent?.includes('Apps das plataformas'));
    expect(shortcut?.getAttribute('href')).toBe('/integracoes/apps');

    button('Conectar conta real', card('Meta Ads'))?.click();
    expect(navigate).toHaveBeenCalledWith(['/integracoes/apps'], { fragment: 'meta' });
    expect(info).not.toHaveBeenCalled();
    expect(card('Meta Ads').textContent).toContain('Clique para configurar o app.');
  });

  it('analista: sem atalho para os apps; o botão bloqueado só explica', async () => {
    await setup({ role: 'analyst' });
    backend.expectOne('/api/connections').flush({ data: [] });
    await settle();
    const navigate = TestBed.inject(Router).navigate as unknown as ReturnType<typeof vi.fn>;
    const info = vi.spyOn(toast, 'info');

    expect([...el.querySelectorAll('a')].some((a) => a.textContent?.includes('Apps das plataformas'))).toBe(false);

    button('Conectar conta real', card('Meta Ads'))?.click();
    expect(navigate).not.toHaveBeenCalledWith(['/integracoes/apps'], expect.anything());
    expect(info).toHaveBeenCalledWith('Conexão real indisponível', {
      message: 'Meta Ads: Credenciais do app ainda não configuradas.',
    });
  });

  it('usa um texto padrão quando o backend não manda observação', async () => {
    await setup();
    backend.expectOne('/api/connections').flush({ data: [] });
    const meta = { ...PROVIDERS[0], live_note: null };
    expect(fixture.componentInstance['liveNote'](meta)).toBe(LIVE_FALLBACK_NOTE);
    await settle();
  });

  it('abre o login no mesmo clique (síncrono) e mostra a espera com "Cancelar"', async () => {
    await setup();
    backend.expectOne('/api/connections').flush({ data: [] });
    await settle();

    button('Conectar demonstração', card('Meta Ads'))?.click();
    // sem await: o window.open tem de acontecer dentro do gesto do usuário
    expect(oauth.starts).toEqual([{ provider: 'meta_ads', tenantId: 't1', mode: 'sandbox' }]);

    await settle();
    expect(card('Meta Ads').textContent).toContain('Aguardando autorização…');
    expect(card('Meta Ads').querySelector('.handshake')).not.toBeNull();
    expect(button('Conectar demonstração', card('Google Analytics 4'))?.disabled).toBe(true);

    button('Cancelar', card('Meta Ads'))?.click();
    expect(oauth.cancel).toHaveBeenCalled();
    oauth.finish({ status: 'cancelled', provider: 'meta_ads', message: 'Conexão cancelada.' });
    await settle();

    expect(card('Meta Ads').textContent).toContain('Conexão cancelada.');
    expect(card('Meta Ads').textContent).not.toContain('Aguardando autorização…');
  });

  it('no sucesso avisa, recarrega as conexões e destaca a nova', async () => {
    await setup();
    backend.expectOne('/api/connections').flush({ data: [] });
    await settle();
    const success = vi.spyOn(toast, 'success');

    button('Conectar demonstração', card('Meta Ads'))?.click();
    oauth.finish({ status: 'success', provider: 'meta_ads', connectionId: 'c1' });
    await tick();

    backend.expectOne('/api/connections').flush({ data: [connection('syncing')] });
    await settle();

    expect(success).toHaveBeenCalledTimes(1);
    expect(success.mock.calls[0][0]).toBe('Meta Ads conectado');
    expect(el.querySelector('.connection.is-new')?.textContent).toContain('Padaria Aurora');
    expect(card('Meta Ads').textContent).toContain('Sincronizando dados…');
  });

  it('mostra o erro no card do canal', async () => {
    await setup();
    backend.expectOne('/api/connections').flush({ data: [] });
    await settle();
    const error = vi.spyOn(toast, 'error');

    button('Conectar conta real', card('Google Analytics 4'))?.click();
    expect(oauth.starts[0]).toEqual({ provider: 'ga4', tenantId: 't1', mode: 'live' });

    oauth.finish({ status: 'error', provider: 'ga4', message: 'Você negou a permissão de leitura.' });
    await settle();

    expect(card('Google Analytics 4').querySelector('[role="alert"]')?.textContent).toContain('Você negou a permissão de leitura.');
    expect(error).toHaveBeenCalledWith('Não foi possível conectar Google Analytics 4', {
      message: 'Você negou a permissão de leitura.',
    });
  });

  it('avisa quando o tempo para autorizar acaba', async () => {
    await setup();
    backend.expectOne('/api/connections').flush({ data: [] });
    await settle();

    button('Conectar demonstração', card('Meta Ads'))?.click();
    oauth.finish({ status: 'timeout', provider: 'meta_ads', message: 'O tempo para autorizar acabou (10 minutos). Tente de novo.' });
    await settle();

    expect(card('Meta Ads').textContent).toContain('O tempo para autorizar acabou');
  });

  it('não entra em espera quando o pop-up foi bloqueado e a aba segue para o login', async () => {
    await setup();
    backend.expectOne('/api/connections').flush({ data: [] });
    await settle();
    oauth.via = 'redirect';

    button('Conectar demonstração', card('Meta Ads'))?.click();
    await settle();

    expect(oauth.starts).toHaveLength(1);
    expect(fixture.componentInstance.pending()).toBeNull();
  });

  it('não mostra os botões de conexão para o papel cliente', async () => {
    await setup({ role: 'client' });
    backend.expectOne('/api/connections').flush({ data: [] });
    await settle();

    expect(button('Conectar demonstração')).toBeUndefined();
    expect(button('Conectar conta real')).toBeUndefined();
    expect(el.textContent).toContain('A equipe da agência ainda não conectou nenhuma conta.');
  });

  it('trata o retorno do modo redirect (?oauth=) e limpa a URL', async () => {
    await setup({ query: { oauth: 'success', provider: 'meta_ads', connection_id: 'c1' } });
    const navigate = TestBed.inject(Router).navigate as unknown as ReturnType<typeof vi.fn>;
    const success = vi.spyOn(toast, 'success');

    expect(navigate).toHaveBeenCalledWith([], {
      queryParams: { oauth: null, provider: null, connection_id: null, message: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    await tick();
    // a primeira carga e a recarga pedida pelo sucesso podem se fundir numa só requisição
    for (const req of backend.match('/api/connections')) req.flush({ data: [connection('active')] });
    await settle();

    expect(success).toHaveBeenCalledTimes(1);
    expect(success.mock.calls[0][0]).toBe('Meta Ads conectado');
    expect(el.querySelector('.connection.is-new')).not.toBeNull();
  });

  it('atualiza a cada 3 s enquanto sincroniza e para quando termina', async () => {
    await setup();
    backend.expectOne('/api/connections').flush({ data: [connection('syncing')] });
    await settle();
    expect(fixture.componentInstance.syncing()).toBe(true);

    vi.advanceTimersByTime(SYNC_POLL_MS);
    await tick();
    backend.expectOne('/api/connections').flush({ data: [connection('active')] });
    await settle();

    expect(fixture.componentInstance.syncing()).toBe(false);
    expect(el.textContent).toContain('Ativa');

    vi.advanceTimersByTime(SYNC_POLL_MS * 5);
    await tick();
    backend.expectNone('/api/connections');
  });

  it('pede sincronização de uma conexão existente', async () => {
    await setup();
    backend.expectOne('/api/connections').flush({ data: [connection('active')] });
    await settle();

    button('Sincronizar agora')?.click();
    await tick();

    const req = backend.expectOne('/api/connections/c1/sync');
    expect(req.request.method).toBe('POST');
    req.flush({ data: connection('syncing') }, { status: 202, statusText: 'Accepted' });
    await settle();
    expect(fixture.componentInstance.syncing()).toBe(true);

    vi.advanceTimersByTime(SYNC_POLL_MS);
    await tick();
    backend.expectOne('/api/connections').flush({ data: [connection('active')] });
    await settle();
  });

  it('conta real expirada: "Reconectar" abre o mesmo login da plataforma em pop-up', async () => {
    await setup();
    const expired: Connection = {
      ...connection('expired'),
      provider: 'ga4',
      mode: 'live',
      label: 'Site',
      last_error: 'O acesso a ga4 expirou ou foi revogado. Reconecte a conta em Integrações (um clique).',
    };
    backend.expectOne('/api/connections').flush({ data: [expired] });
    await settle();

    expect(el.textContent).toContain('Acesso expirado');
    expect(el.textContent).toContain('Reconecte a conta em Integrações');
    expect(button('Sincronizar agora')).toBeUndefined();

    button('Reconectar')!.click();
    await tick();
    expect(oauth.starts).toEqual([{ provider: 'ga4', tenantId: 't1', mode: 'live' }]);
  });

  it('acesso perto do fim: avisa os dias que faltam e oferece reconectar agora', async () => {
    await setup();
    const soon: Connection = {
      ...connection('active'),
      provider: 'ga4',
      mode: 'live',
      expires_at: new Date(Date.now() + 5 * 86_400_000 - 60_000).toISOString(),
      expiring_soon: true,
    };
    backend.expectOne('/api/connections').flush({ data: [soon] });
    await settle();

    expect(el.querySelector('.expiring')?.textContent).toContain('O acesso desta conta expira em 5 dias.');
    button('Reconectar agora')!.click();
    await tick();
    expect(oauth.starts[0]).toEqual({ provider: 'ga4', tenantId: 't1', mode: 'live' });
  });

  it('para de escutar o fluxo pendente quando a tela é destruída', async () => {
    await setup();
    backend.expectOne('/api/connections').flush({ data: [] });
    await settle();

    button('Conectar demonstração', card('Meta Ads'))?.click();
    fixture.destroy();

    expect(oauth.dispose).toHaveBeenCalled();
  });
});
