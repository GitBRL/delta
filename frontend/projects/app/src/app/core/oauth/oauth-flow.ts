import { ConnectionMode } from '../api/api.types';

/**
 * Peças puras do fluxo de conexão em pop-up (login OAuth da plataforma em outra janela).
 *
 * Contrato com o backend:
 *  - início: GET /oauth/{provider}/start?tenant_id&mode&flow&return  (rota web, cookie de sessão)
 *  - resultado: a página de retorno (mesma origem) entrega {type:'delta:oauth', flow, status, ...}
 *    por três canais: postMessage para o opener, BroadcastChannel e evento "storage".
 */

export const OAUTH_WINDOW_NAME = 'delta-oauth';
export const OAUTH_CHANNEL = 'delta-oauth';
export const OAUTH_STORAGE_KEY = 'delta-oauth-result';
export const OAUTH_MESSAGE_TYPE = 'delta:oauth';
/** Tempo máximo esperando a autorização na outra janela. */
export const OAUTH_TIMEOUT_MS = 10 * 60 * 1000;

export const POPUP_WIDTH = 520;
export const POPUP_HEIGHT = 720;

export type OAuthReturn = 'popup' | 'redirect';
export type OAuthResultStatus = 'success' | 'error' | 'cancelled';

/** Mensagem que a página de retorno do backend envia. */
export interface OAuthResultMessage {
  type: typeof OAUTH_MESSAGE_TYPE;
  flow: string;
  status: OAuthResultStatus;
  provider: string;
  connection_id?: string;
  message?: string;
}

/** Desfecho visto pela tela: o resultado da plataforma, ou desistência/tempo esgotado locais. */
export interface OAuthOutcome {
  status: OAuthResultStatus | 'timeout';
  provider: string;
  connectionId?: string;
  message?: string;
}

export interface OAuthStartParams {
  provider: string;
  tenantId: string;
  mode: ConnectionMode;
  flow: string;
  returnTo: OAuthReturn;
}

const FLOW_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Id aleatório do fluxo (base64url, 32 caracteres): casa o resultado com o clique certo. */
export function newFlowId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isFlowId(value: unknown): value is string {
  return typeof value === 'string' && FLOW_PATTERN.test(value);
}

export function oauthStartUrl(params: OAuthStartParams): string {
  const query = new URLSearchParams({
    tenant_id: params.tenantId,
    mode: params.mode,
    flow: params.flow,
    return: params.returnTo,
  });
  return `/oauth/${encodeURIComponent(params.provider)}/start?${query.toString()}`;
}

export interface ConnectSessionStartParams {
  provider: string;
  /** Token da sessão hospedada do Delta Connect (48 caracteres). */
  session: string;
  mode: ConnectionMode;
  flow: string;
}

/**
 * Delta Connect (ADR 0032): início pela sessão hospedada, sem login e sem tenant_id. Só em
 * pop-up: no modo redirect o backend volta para /integracoes, que exige conta no Delta.
 */
export function connectSessionStartUrl(params: ConnectSessionStartParams): string {
  const query = new URLSearchParams({
    connect_session: params.session,
    mode: params.mode,
    flow: params.flow,
    return: 'popup',
  });
  return `/oauth/${encodeURIComponent(params.provider)}/start?${query.toString()}`;
}

export interface WindowGeometry {
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
}

/** Features do window.open: janela 520×720 centralizada sobre a janela atual. */
export function popupFeatures(geometry: WindowGeometry, width = POPUP_WIDTH, height = POPUP_HEIGHT): string {
  const left = Math.max(0, Math.round(geometry.screenX + (geometry.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(geometry.screenY + (geometry.outerHeight - height) / 2));
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
}

const STATUSES: readonly OAuthResultStatus[] = ['success', 'error', 'cancelled'];

/** Valida o formato da mensagem de resultado; qualquer coisa fora do contrato vira null. */
export function parseOAuthResult(data: unknown): OAuthResultMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;

  if (d['type'] !== OAUTH_MESSAGE_TYPE || !isFlowId(d['flow']) || typeof d['provider'] !== 'string') return null;
  if (!STATUSES.includes(d['status'] as OAuthResultStatus)) return null;
  if (d['connection_id'] !== undefined && typeof d['connection_id'] !== 'string') return null;
  if (d['message'] !== undefined && typeof d['message'] !== 'string') return null;

  return {
    type: OAUTH_MESSAGE_TYPE,
    flow: d['flow'],
    status: d['status'] as OAuthResultStatus,
    provider: d['provider'],
    ...(d['connection_id'] ? { connection_id: d['connection_id'] as string } : {}),
    ...(d['message'] ? { message: d['message'] as string } : {}),
  };
}

export function outcomeFromMessage(message: OAuthResultMessage): OAuthOutcome {
  return {
    status: message.status,
    provider: message.provider,
    ...(message.connection_id ? { connectionId: message.connection_id } : {}),
    ...(message.message ? { message: message.message } : {}),
  };
}

/** Parâmetros que o backend acrescenta em /integracoes no modo return=redirect. */
export const OAUTH_QUERY_KEYS = ['oauth', 'provider', 'connection_id', 'message'] as const;

/** Lê ?oauth=success|error|cancelled&provider=…&connection_id=…&message=… (modo redirect). */
export function parseOAuthQuery(get: (key: string) => string | null): OAuthOutcome | null {
  const status = get('oauth');
  const provider = get('provider');
  if (!status || !STATUSES.includes(status as OAuthResultStatus) || !provider) return null;

  const connectionId = get('connection_id');
  const message = get('message');
  return {
    status: status as OAuthResultStatus,
    provider,
    ...(connectionId ? { connectionId } : {}),
    ...(message ? { message } : {}),
  };
}
