import { TestBed } from '@angular/core/testing';
import { DsToastService } from 'design-system';
import { OAuthBrowser, OAuthChannel, OAuthPopup } from './oauth-browser';
import { OAUTH_MESSAGE_TYPE, OAUTH_STORAGE_KEY, OAUTH_TIMEOUT_MS, OAuthOutcome } from './oauth-flow';
import { OAuthService, POPUP_BLOCKED_MESSAGE } from './oauth.service';

const ORIGIN = 'http://localhost:4300';

/** Navegador falso: registra aberturas/navegações e permite disparar os três canais. */
class FakeBrowser {
  popup: { closed: boolean; close: ReturnType<typeof vi.fn<() => void>> } | null = {
    closed: false,
    close: vi.fn<() => void>(),
  };
  opened: { url: string; name: string; features: string }[] = [];
  assigned: string[] = [];
  removed: string[] = [];
  channels: (OAuthChannel & { closed: boolean })[] = [];
  private handlers: Record<string, ((event: Event) => void)[]> = { message: [], storage: [] };

  open(url: string, name: string, features: string): OAuthPopup | null {
    this.opened.push({ url, name, features });
    return this.popup;
  }
  assign(url: string): void {
    this.assigned.push(url);
  }
  origin(): string {
    return ORIGIN;
  }
  geometry() {
    return { screenX: 0, screenY: 0, outerWidth: 1280, outerHeight: 800 };
  }
  channel(): OAuthChannel {
    const channel = { onmessage: null, closed: false, close() { this.closed = true; } } as OAuthChannel & { closed: boolean };
    this.channels.push(channel);
    return channel;
  }
  listen(type: 'message' | 'storage', handler: (event: never) => void): () => void {
    const h = handler as (event: Event) => void;
    this.handlers[type].push(h);
    return () => (this.handlers[type] = this.handlers[type].filter((x) => x !== h));
  }
  removeStored(key: string): void {
    this.removed.push(key);
  }

  listeners(type: 'message' | 'storage'): number {
    return this.handlers[type].length;
  }
  postMessage(data: unknown, origin = ORIGIN): void {
    for (const h of this.handlers['message']) h(new MessageEvent('message', { data, origin }));
  }
  broadcast(data: unknown): void {
    for (const c of this.channels) c.onmessage?.(new MessageEvent('message', { data }));
  }
  storage(value: string | null, key = OAUTH_STORAGE_KEY): void {
    for (const h of this.handlers['storage']) h(new StorageEvent('storage', { key, newValue: value }));
  }
}

describe('OAuthService', () => {
  let browser: FakeBrowser;
  let service: OAuthService;
  let toast: { info: ReturnType<typeof vi.fn> };

  const message = (flow: string, extra: Record<string, unknown> = {}) => ({
    type: OAUTH_MESSAGE_TYPE,
    flow,
    status: 'success',
    provider: 'meta_ads',
    connection_id: 'c-1',
    ...extra,
  });

  /** Captura o desfecho sem bloquear o teste quando ele ainda não chegou. */
  function track(result: Promise<OAuthOutcome>): { outcome: OAuthOutcome | null } {
    const box: { outcome: OAuthOutcome | null } = { outcome: null };
    void result.then((o) => (box.outcome = o));
    return box;
  }
  const flush = () => Promise.resolve();

  beforeEach(() => {
    vi.useFakeTimers();
    browser = new FakeBrowser();
    toast = { info: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: OAuthBrowser, useValue: browser },
        { provide: DsToastService, useValue: toast },
      ],
    });
    service = TestBed.inject(OAuthService);
  });

  afterEach(() => vi.useRealTimers());

  it('abre o pop-up na hora (síncrono), com a URL do contrato e janela centralizada', () => {
    const flow = service.start({ provider: 'meta_ads', tenantId: 't1', mode: 'sandbox' });

    expect(browser.opened).toHaveLength(1);
    const { url, name, features } = browser.opened[0];
    const params = new URLSearchParams(url.split('?')[1]);
    expect(url.startsWith('/oauth/meta_ads/start?')).toBe(true);
    expect(params.get('tenant_id')).toBe('t1');
    expect(params.get('mode')).toBe('sandbox');
    expect(params.get('return')).toBe('popup');
    expect(params.get('flow')).toBe(flow.flow);
    expect(name).toBe('delta-oauth');
    expect(features).toContain('width=520,height=720');
    expect(flow.via).toBe('popup');
  });

  it('cai para a mesma aba quando o navegador bloqueia o pop-up', () => {
    browser.popup = null;
    const flow = service.start({ provider: 'ga4', tenantId: 't1', mode: 'live' });

    expect(flow.via).toBe('redirect');
    expect(toast.info).toHaveBeenCalledWith('Janela de login bloqueada', { message: POPUP_BLOCKED_MESSAGE });
    expect(browser.assigned).toHaveLength(1);
    const params = new URLSearchParams(browser.assigned[0].split('?')[1]);
    expect(params.get('return')).toBe('redirect');
    expect(params.get('flow')).toBe(flow.flow);
    expect(params.get('mode')).toBe('live');
  });

  it('sessão hospedada do Connect: abre o pop-up com connect_session, sem tenant', async () => {
    const flow = service.startSession({ provider: 'meta_ads', session: 'k'.repeat(48), mode: 'sandbox' })!;

    const params = new URLSearchParams(browser.opened[0].url.split('?')[1]);
    expect(browser.opened[0].url.startsWith('/oauth/meta_ads/start?')).toBe(true);
    expect(params.get('connect_session')).toBe('k'.repeat(48));
    expect(params.get('tenant_id')).toBeNull();
    expect(params.get('return')).toBe('popup');
    expect(params.get('flow')).toBe(flow.flow);

    browser.postMessage(message(flow.flow));
    expect((await flow.result).status).toBe('success');
  });

  it('sessão hospedada com pop-up bloqueado: devolve null e não navega (o redirect exige login)', () => {
    browser.popup = null;
    expect(service.startSession({ provider: 'ga4', session: 'k'.repeat(48), mode: 'live' })).toBeNull();
    expect(browser.assigned).toEqual([]);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('recebe o resultado por postMessage da mesma origem', async () => {
    const flow = service.start({ provider: 'meta_ads', tenantId: 't1', mode: 'sandbox' });
    browser.postMessage(message(flow.flow));

    expect(await flow.result).toEqual({ status: 'success', provider: 'meta_ads', connectionId: 'c-1' });
    expect(browser.removed).toEqual([OAUTH_STORAGE_KEY]);
  });

  it('recebe o resultado pelo BroadcastChannel', async () => {
    const flow = service.start({ provider: 'meta_ads', tenantId: 't1', mode: 'live' });
    browser.broadcast(message(flow.flow, { status: 'error', message: 'Permissão negada' }));

    expect(await flow.result).toEqual({ status: 'error', provider: 'meta_ads', connectionId: 'c-1', message: 'Permissão negada' });
  });

  it('recebe o resultado pelo evento storage', async () => {
    const flow = service.start({ provider: 'meta_ads', tenantId: 't1', mode: 'sandbox' });
    browser.storage('não é json');
    browser.storage(JSON.stringify(message(flow.flow)), 'outra-chave');
    browser.storage(JSON.stringify(message(flow.flow, { status: 'cancelled' })));

    expect((await flow.result).status).toBe('cancelled');
  });

  it('vale só a primeira entrega: os três canais são deduplicados e os ouvintes saem', async () => {
    const flow = service.start({ provider: 'meta_ads', tenantId: 't1', mode: 'sandbox' });
    const box = track(flow.result);

    browser.broadcast(message(flow.flow));
    browser.postMessage(message(flow.flow, { status: 'error' }));
    browser.storage(JSON.stringify(message(flow.flow, { status: 'cancelled' })));
    await flush();

    expect(box.outcome?.status).toBe('success');
    expect(browser.listeners('message')).toBe(0);
    expect(browser.listeners('storage')).toBe(0);
    expect(browser.channels[0].closed).toBe(true);
  });

  it('ignora origem estranha, outro fluxo e mensagens fora do formato', async () => {
    const flow = service.start({ provider: 'meta_ads', tenantId: 't1', mode: 'sandbox' });
    const box = track(flow.result);

    browser.postMessage(message(flow.flow), 'https://evil.example');
    browser.postMessage(message('outro_fluxo_qualquer_123'));
    browser.broadcast({ type: 'delta:oauth', flow: flow.flow, status: 'hacked', provider: 'meta_ads' });
    browser.broadcast('success');
    await flush();

    expect(box.outcome).toBeNull();
  });

  it('não trata popup.closed como cancelamento (COOP do Google/Meta corta o vínculo)', async () => {
    const flow = service.start({ provider: 'meta_ads', tenantId: 't1', mode: 'live' });
    const box = track(flow.result);

    browser.popup!.closed = true;
    vi.advanceTimersByTime(5 * 60 * 1000);
    await flush();
    expect(box.outcome).toBeNull();

    browser.broadcast(message(flow.flow));
    await flush();
    expect(box.outcome?.status).toBe('success');
  });

  it('desiste sozinho depois de 10 minutos', async () => {
    const flow = service.start({ provider: 'ga4', tenantId: 't1', mode: 'live' });
    const box = track(flow.result);

    vi.advanceTimersByTime(OAUTH_TIMEOUT_MS - 1);
    await flush();
    expect(box.outcome).toBeNull();

    vi.advanceTimersByTime(1);
    await flush();
    expect(box.outcome).toMatchObject({ status: 'timeout', provider: 'ga4' });
  });

  it('cancelar fecha a janela e resolve como cancelado', async () => {
    const flow = service.start({ provider: 'meta_ads', tenantId: 't1', mode: 'sandbox' });
    flow.cancel();

    expect(browser.popup!.close).toHaveBeenCalled();
    expect(await flow.result).toMatchObject({ status: 'cancelled', provider: 'meta_ads' });
  });

  it('dispose para de escutar sem fechar a janela nem resolver', async () => {
    const flow = service.start({ provider: 'meta_ads', tenantId: 't1', mode: 'sandbox' });
    const box = track(flow.result);

    flow.dispose();
    browser.broadcast(message(flow.flow));
    vi.advanceTimersByTime(OAUTH_TIMEOUT_MS);
    await flush();

    expect(box.outcome).toBeNull();
    expect(browser.popup!.close).not.toHaveBeenCalled();
    expect(browser.listeners('message')).toBe(0);
  });
});
