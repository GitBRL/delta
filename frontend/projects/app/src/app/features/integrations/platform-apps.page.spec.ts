import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { Me, PlatformApp, PlatformAppResponse } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import {
  appDraftFrom,
  appStatusMeta,
  buildAppBody,
  joinNames,
  missingPlatformNames,
  validateAppDraft,
} from './platform-apps';
import { PlatformAppsPage } from './platform-apps.page';

const me = (role: string): Me => ({
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const META: PlatformApp = {
  vendor: 'meta',
  name: 'Meta',
  platforms: [
    { key: 'meta_ads', name: 'Meta Ads' },
    { key: 'facebook', name: 'Facebook' },
    { key: 'instagram', name: 'Instagram' },
  ],
  status: 'missing',
  source: null,
  client_id: null,
  client_secret_hint: null,
  developer_token_hint: null,
  requires_developer_token: false,
  verified_at: null,
  verification_error: null,
  updated_at: null,
  updated_by: null,
  redirect_uris: [
    'http://localhost:4300/oauth/meta_ads/callback',
    'http://localhost:4300/oauth/facebook/callback',
    'http://localhost:4300/oauth/instagram/callback',
  ],
  console_url: 'https://developers.facebook.com/apps',
  missing_platforms: ['meta_ads', 'facebook', 'instagram'],
};

const GOOGLE: PlatformApp = {
  vendor: 'google',
  name: 'Google',
  platforms: [
    { key: 'ga4', name: 'Google Analytics 4' },
    { key: 'google_ads', name: 'Google Ads' },
  ],
  status: 'verified',
  source: 'agency',
  client_id: '123-abc.apps.googleusercontent.com',
  client_secret_hint: '••••9xyz',
  developer_token_hint: null,
  requires_developer_token: true,
  verified_at: new Date().toISOString(),
  verification_error: null,
  updated_at: new Date().toISOString(),
  updated_by: 'Ana Lima',
  redirect_uris: ['http://localhost:4300/oauth/ga4/callback', 'http://localhost:4300/oauth/google_ads/callback'],
  console_url: 'https://console.cloud.google.com/apis/credentials',
  missing_platforms: ['google_ads'],
};

const TIKTOK: PlatformApp = {
  ...META,
  vendor: 'tiktok',
  name: 'TikTok',
  platforms: [{ key: 'tiktok_ads', name: 'TikTok Ads' }],
  redirect_uris: ['http://localhost:4300/oauth/tiktok_ads/callback'],
  console_url: 'https://business-api.tiktok.com/portal/apps',
  missing_platforms: ['tiktok_ads'],
};

const LINKEDIN: PlatformApp = {
  ...META,
  vendor: 'linkedin',
  name: 'LinkedIn',
  platforms: [{ key: 'linkedin_ads', name: 'LinkedIn Ads' }],
  redirect_uris: ['http://localhost:4300/oauth/linkedin_ads/callback'],
  console_url: 'https://www.linkedin.com/developers/apps',
  missing_platforms: ['linkedin_ads'],
};

describe('helpers dos apps das plataformas', () => {
  it('junta nomes em pt-BR', () => {
    expect(joinNames(['Meta Ads', 'Facebook', 'Instagram'])).toBe('Meta Ads, Facebook e Instagram');
    expect(joinNames(['GA4'])).toBe('GA4');
    expect(joinNames([])).toBe('');
  });

  it('omite segredo e token em branco do corpo (o backend mantém os atuais)', () => {
    expect(buildAppBody(GOOGLE, { client_id: ' 123-abc.apps.googleusercontent.com ', client_secret: '  ', developer_token: '' })).toEqual({
      client_id: '123-abc.apps.googleusercontent.com',
    });
    expect(buildAppBody(GOOGLE, { client_id: 'x', client_secret: 's3', developer_token: 'tok' })).toEqual({
      client_id: 'x',
      client_secret: 's3',
      developer_token: 'tok',
    });
    // a Meta não tem developer token
    expect(buildAppBody(META, { client_id: '1', client_secret: 's', developer_token: 'tok' })).toEqual({
      client_id: '1',
      client_secret: 's',
    });
  });

  it('exige a chave secreta só na primeira vez', () => {
    expect(validateAppDraft(META, { client_id: '', client_secret: '', developer_token: '' })).toEqual({
      client_id: 'Informe o ID do app.',
      client_secret: 'Informe a chave secreta.',
    });
    expect(validateAppDraft(GOOGLE, { client_id: 'x', client_secret: '', developer_token: '' })).toEqual({});
  });

  it('usa os nomes de cada painel nas mensagens do TikTok e do LinkedIn', () => {
    const empty = { client_id: '', client_secret: '', developer_token: '' };
    expect(validateAppDraft(TIKTOK, empty)).toEqual({ client_id: 'Informe o App ID.', client_secret: 'Informe o Secret.' });
    expect(validateAppDraft(LINKEDIN, empty)).toEqual({
      client_id: 'Informe o Client ID.',
      client_secret: 'Informe o Client Secret.',
    });
  });

  it('no TikTok, "não verificado" é o normal até a primeira conexão', () => {
    expect(appStatusMeta({ ...TIKTOK, status: 'unverified', source: 'agency' })).toEqual({
      level: 'opportunity',
      label: 'Confere na 1ª conexão',
    });
    expect(appStatusMeta({ ...LINKEDIN, status: 'unverified', source: 'agency' }).label).toBe('Não verificado');
  });

  it('rascunho traz só o ID salvo pela agência e nomes das plataformas pendentes', () => {
    expect(appDraftFrom(GOOGLE)).toEqual({ client_id: GOOGLE.client_id, client_secret: '', developer_token: '' });
    expect(appDraftFrom({ ...META, status: 'server', source: 'server', client_id: 'do-servidor' }).client_id).toBe('');
    expect(missingPlatformNames(GOOGLE)).toEqual(['Google Ads']);
  });
});

describe('PlatformAppsPage', () => {
  let fixture: ComponentFixture<PlatformAppsPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let toast: DsToastService;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }
  async function settle(): Promise<void> {
    await tick();
    await fixture.whenStable();
  }
  const card = (vendor: string) => el.querySelector<HTMLElement>(`#app-${vendor}`)!;
  const button = (text: string, scope: ParentNode = el) =>
    [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text));
  const input = (name: string) => el.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
  const type = (name: string, value: string) => {
    const field = input(name);
    field.value = value;
    field.dispatchEvent(new Event('input'));
  };
  const submit = (vendor: string) => card(vendor).querySelector('form')!.dispatchEvent(new Event('submit'));

  async function setup(options: { role?: string; fragment?: string } = {}): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(options.role ?? 'owner')), status: signal('authenticated') } },
        ...(options.fragment
          ? [{ provide: ActivatedRoute, useValue: { snapshot: { fragment: options.fragment, queryParamMap: new Map() } } }]
          : []),
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(DsToastService);
    fixture = TestBed.createComponent(PlatformAppsPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
  }

  async function loaded(apps: PlatformApp[] = [META, GOOGLE], options: { role?: string; fragment?: string } = {}) {
    await setup(options);
    const req = backend.expectOne('/api/platform-apps');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    req.flush({ data: apps });
    await settle();
  }

  afterEach(() => backend.verify());

  it('para quem não é dono/admin, explica e nem chama a API', async () => {
    await setup({ role: 'analyst' });
    await settle();

    backend.expectNone('/api/platform-apps');
    expect(el.textContent).toContain('Só donos e administradores da agência configuram os apps das plataformas.');
    expect(el.querySelector('form')).toBeNull();
  });

  it('mostra um card por app com estado, plataformas, guia e endereços de retorno', async () => {
    await loaded();

    expect(card('meta').textContent).toContain('Usado por Meta Ads, Facebook e Instagram');
    expect(card('meta').querySelector('.chip')?.textContent).toContain('Não configurado');
    expect(card('meta').querySelector<HTMLDetailsElement>('details')?.open).toBe(true);
    expect(card('meta').querySelector('a[target="_blank"]')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(card('meta').querySelectorAll('.uri')).toHaveLength(3);
    expect(button('Testar de novo', card('meta'))).toBeUndefined();

    expect(card('google').querySelector('ds-status-badge')?.textContent).toContain('Verificado');
    expect(card('google').querySelector<HTMLDetailsElement>('details')?.open).toBe(false);
    expect(card('google').textContent).toContain('Atualizado por Ana Lima');
    expect(card('google').textContent).toContain('Ainda sem login real: Google Ads.');
    expect(input('client_id_google').value).toBe('123-abc.apps.googleusercontent.com');
    expect(input('client_secret_google').value).toBe('');
    expect(input('client_secret_google').type).toBe('password');
    expect(card('google').textContent).toContain('Deixe em branco para manter');
    expect(input('developer_token_google')).not.toBeNull();
    expect(el.querySelector('input[name=developer_token_meta]')).toBeNull();
  });

  it('salva mantendo o segredo quando o campo fica em branco e mostra a verificação', async () => {
    await loaded();
    const success = vi.spyOn(toast, 'success');

    type('developer_token_google', 'dev-token-123');
    submit('google');
    await tick();

    const req = backend.expectOne('/api/platform-apps/google');
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    expect(req.request.body).toEqual({ client_id: '123-abc.apps.googleusercontent.com', developer_token: 'dev-token-123' });
    const res: PlatformAppResponse = {
      data: { ...GOOGLE, developer_token_hint: '••••-123', missing_platforms: [] },
      verification: { status: 'verified', message: 'O Google confirmou o ID e a chave secreta.' },
    };
    req.flush(res);
    await settle();

    expect(success).toHaveBeenCalledWith('App do Google salvo e verificado', {
      message: 'O Google confirmou o ID e a chave secreta.',
    });
    expect(card('google').querySelector('.result.is-ok')?.textContent).toContain('O Google confirmou');
    expect(input('developer_token_google').value).toBe(''); // o token não fica na tela depois de salvo
    expect(card('google').textContent).not.toContain('Ainda sem login real');
  });

  it('pede a chave secreta na primeira vez sem chamar a API e mostra os erros do servidor por campo', async () => {
    await loaded();

    type('client_id_meta', '1234567890');
    submit('meta');
    await settle();
    backend.expectNone('/api/platform-apps/meta');
    expect(card('meta').textContent).toContain('Informe a chave secreta.');

    type('client_secret_meta', 'segredo-do-app');
    submit('meta');
    await tick();
    const req = backend.expectOne('/api/platform-apps/meta');
    expect(req.request.body).toEqual({ client_id: '1234567890', client_secret: 'segredo-do-app' });
    req.flush(
      { message: 'O ID do app tem só números.', errors: { client_id: ['O ID do app tem só números.'] } },
      { status: 422, statusText: 'Unprocessable Content' },
    );
    await settle();

    expect(card('meta').querySelector('ds-text-field.has-error')?.textContent).toContain('O ID do app tem só números.');
    // 422: mantém o que foi digitado para corrigir só o campo apontado
    expect(fixture.componentInstance.drafts().meta?.client_secret).toBe('segredo-do-app');
  });

  it('avisa quando a plataforma recusa as credenciais ao testar de novo', async () => {
    await loaded();
    const error = vi.spyOn(toast, 'error');

    button('Testar de novo', card('google'))?.click();
    await tick();
    const req = backend.expectOne('/api/platform-apps/google/verify');
    expect(req.request.method).toBe('POST');
    req.flush({
      data: { ...GOOGLE, status: 'invalid', verification_error: 'O Google recusou o ID ou a chave secreta.' },
      verification: { status: 'invalid', message: 'O Google recusou o ID ou a chave secreta.' },
    } satisfies PlatformAppResponse);
    await settle();

    expect(card('google').querySelector('ds-status-badge')?.textContent).toContain('Credenciais recusadas');
    expect(card('google').querySelector('.result.is-error[role="alert"]')?.textContent).toContain('recusou');
    expect(error).toHaveBeenCalledWith('Google recusou as credenciais', {
      message: 'O Google recusou o ID ou a chave secreta.',
    });
  });

  it('remove só depois de confirmar e recarrega o estado', async () => {
    await loaded();

    button('Remover', card('google'))?.click();
    await settle();
    backend.expectNone('/api/platform-apps/google');
    expect(card('google').textContent).toContain('podem parar de renovar o acesso');

    button('Cancelar', card('google'))?.click();
    await settle();
    expect(card('google').textContent).not.toContain('podem parar de renovar o acesso');

    button('Remover', card('google'))?.click();
    await settle();
    const confirm = [...card('google').querySelectorAll('button')].find((b) => b.getAttribute('data-variant') === 'destructive');
    confirm?.click();
    await tick();

    const req = backend.expectOne('/api/platform-apps/google');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await tick();

    backend.expectOne('/api/platform-apps').flush({ data: [META, { ...GOOGLE, status: 'missing', source: null, client_id: null }] });
    await settle();
    expect(card('google').querySelector('.chip')?.textContent).toContain('Não configurado');
    expect(input('client_id_google').value).toBe('');
  });

  it('mostra os cards do TikTok e do LinkedIn com os campos de cada painel, sem developer token', async () => {
    await loaded([META, GOOGLE, TIKTOK, LINKEDIN]);

    expect(card('tiktok').textContent).toContain('Usado por TikTok Ads');
    expect(card('tiktok').textContent).toContain('App ID');
    expect(card('tiktok').textContent).toContain('Secret');
    expect(card('tiktok').textContent).toContain('Como criar o app do TikTok');
    expect(card('linkedin').textContent).toContain('Client ID');
    expect(card('linkedin').textContent).toContain('Client Secret');
    expect(card('linkedin').querySelectorAll('.uri')).toHaveLength(1);
    expect(el.querySelector('input[name=developer_token_tiktok]')).toBeNull();
    expect(el.querySelector('input[name=developer_token_linkedin]')).toBeNull();
  });

  it('no TikTok, salvar sem verificar mostra a explicação da plataforma, sem tom de erro', async () => {
    await loaded([META, GOOGLE, TIKTOK, LINKEDIN]);
    const info = vi.spyOn(toast, 'info');
    const error = vi.spyOn(toast, 'error');
    const message = 'O TikTok não permite conferir o app sem autorizar um anunciante: ele será conferido na primeira conexão.';

    type('client_id_tiktok', '7300000000000000001');
    type('client_secret_tiktok', 'segredo-tiktok');
    submit('tiktok');
    await tick();
    const req = backend.expectOne('/api/platform-apps/tiktok');
    expect(req.request.body).toEqual({ client_id: '7300000000000000001', client_secret: 'segredo-tiktok' });
    req.flush({
      data: { ...TIKTOK, status: 'unverified', source: 'agency', client_id: '7300000000000000001', client_secret_hint: '••••' },
      verification: { status: 'unreachable', message },
    } satisfies PlatformAppResponse);
    await settle();

    expect(info).toHaveBeenCalledWith('App do TikTok salvo', { message });
    expect(error).not.toHaveBeenCalled();
    expect(card('tiktok').querySelector('.result')?.textContent).toContain('primeira conexão');
    expect(card('tiktok').querySelector('.result.is-error')).toBeNull();
    expect(card('tiktok').querySelector('ds-status-badge')?.textContent).toContain('Confere na 1ª conexão');
  });

  it('copia o endereço de retorno', async () => {
    await loaded();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const success = vi.spyOn(toast, 'success');

    button('Copiar', card('meta'))?.click();
    await settle();

    expect(writeText).toHaveBeenCalledWith('http://localhost:4300/oauth/meta_ads/callback');
    expect(success).toHaveBeenCalledWith('Copiado', { message: 'http://localhost:4300/oauth/meta_ads/callback' });
  });

  it('vindo de Integrações (#google), destaca o card e foca o primeiro campo', async () => {
    await loaded([META, GOOGLE], { fragment: 'google' });
    await settle();

    expect(card('google').classList).toContain('is-target');
    expect(document.activeElement).toBe(input('client_id_google'));
  });
});
