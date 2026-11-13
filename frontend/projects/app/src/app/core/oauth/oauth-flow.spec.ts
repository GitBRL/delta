import {
  OAUTH_MESSAGE_TYPE,
  connectSessionStartUrl,
  isFlowId,
  newFlowId,
  oauthStartUrl,
  outcomeFromMessage,
  parseOAuthQuery,
  parseOAuthResult,
  popupFeatures,
} from './oauth-flow';

const FLOW = 'abcdefghijklmnop_QRS-tuv';

describe('fluxo OAuth: peças puras', () => {
  it('gera ids de fluxo aleatórios dentro do formato do contrato', () => {
    const a = newFlowId();
    const b = newFlowId();
    expect(isFlowId(a)).toBe(true);
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(a).not.toBe(b);
  });

  it('monta a URL de início com tenant, modo, fluxo e retorno', () => {
    const url = oauthStartUrl({ provider: 'meta_ads', tenantId: 't-1', mode: 'live', flow: FLOW, returnTo: 'popup' });
    const [path, query] = url.split('?');
    const params = new URLSearchParams(query);

    expect(path).toBe('/oauth/meta_ads/start');
    expect(Object.fromEntries(params)).toEqual({ tenant_id: 't-1', mode: 'live', flow: FLOW, return: 'popup' });
  });

  it('monta a URL da sessão hospedada do Connect (sempre em pop-up)', () => {
    const url = connectSessionStartUrl({ provider: 'ga4', session: 's'.repeat(48), mode: 'sandbox', flow: FLOW });
    const [path, query] = url.split('?');
    expect(path).toBe('/oauth/ga4/start');
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({ connect_session: 's'.repeat(48), mode: 'sandbox', flow: FLOW, return: 'popup' });
  });

  it('escapa o provider no caminho', () => {
    expect(oauthStartUrl({ provider: 'a/b', tenantId: 't', mode: 'sandbox', flow: FLOW, returnTo: 'redirect' })).toContain(
      '/oauth/a%2Fb/start?',
    );
  });

  it('centraliza a janela 520×720 sobre a janela atual', () => {
    const features = popupFeatures({ screenX: 100, screenY: 50, outerWidth: 1440, outerHeight: 900 });
    expect(features).toBe('popup=yes,width=520,height=720,left=560,top=140');
  });

  it('não posiciona a janela fora da tela', () => {
    expect(popupFeatures({ screenX: 0, screenY: 0, outerWidth: 300, outerHeight: 300 })).toContain('left=0,top=0');
  });

  it('aceita só mensagens no formato do contrato', () => {
    const ok = { type: OAUTH_MESSAGE_TYPE, flow: FLOW, status: 'success', provider: 'ga4', connection_id: 'c1' };
    expect(parseOAuthResult(ok)).toEqual(ok);

    expect(parseOAuthResult(null)).toBeNull();
    expect(parseOAuthResult('delta:oauth')).toBeNull();
    expect(parseOAuthResult({ ...ok, type: 'outra-coisa' })).toBeNull();
    expect(parseOAuthResult({ ...ok, status: 'talvez' })).toBeNull();
    expect(parseOAuthResult({ ...ok, flow: 'curto' })).toBeNull();
    expect(parseOAuthResult({ ...ok, provider: 42 })).toBeNull();
    expect(parseOAuthResult({ ...ok, message: { html: '<b>x</b>' } })).toBeNull();
  });

  it('converte a mensagem em desfecho', () => {
    expect(
      outcomeFromMessage({ type: OAUTH_MESSAGE_TYPE, flow: FLOW, status: 'error', provider: 'ga4', message: 'Negado' }),
    ).toEqual({ status: 'error', provider: 'ga4', message: 'Negado' });
  });

  it('lê o resultado do modo redirect na query', () => {
    const query = new URLSearchParams('oauth=success&provider=meta_ads&connection_id=c9&message=Pronto');
    expect(parseOAuthQuery((k) => query.get(k))).toEqual({
      status: 'success',
      provider: 'meta_ads',
      connectionId: 'c9',
      message: 'Pronto',
    });

    expect(parseOAuthQuery((k) => new URLSearchParams('oauth=success').get(k))).toBeNull();
    expect(parseOAuthQuery((k) => new URLSearchParams('oauth=hack&provider=x').get(k))).toBeNull();
    expect(parseOAuthQuery((k) => new URLSearchParams('').get(k))).toBeNull();
  });
});
