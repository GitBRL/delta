import { Injectable, inject } from '@angular/core';
import { DsToastService } from 'design-system';
import { ConnectionMode } from '../api/api.types';
import { OAuthBrowser, OAuthPopup } from './oauth-browser';
import {
  OAUTH_CHANNEL,
  OAUTH_STORAGE_KEY,
  OAUTH_TIMEOUT_MS,
  OAUTH_WINDOW_NAME,
  OAuthOutcome,
  connectSessionStartUrl,
  newFlowId,
  oauthStartUrl,
  outcomeFromMessage,
  parseOAuthResult,
  popupFeatures,
} from './oauth-flow';

export interface OAuthStartRequest {
  provider: string;
  tenantId: string;
  mode: ConnectionMode;
}

/** Um fluxo de conexão em andamento. */
export interface OAuthFlow {
  readonly flow: string;
  /** 'popup': esperando a outra janela; 'redirect': a aba atual está indo para o login. */
  readonly via: 'popup' | 'redirect';
  /** Resolve uma única vez: resultado da plataforma, cancelamento ou tempo esgotado. */
  readonly result: Promise<OAuthOutcome>;
  /** Desiste: fecha a janela (se ainda houver referência) e resolve como "cancelled". */
  cancel(): void;
  /** Para de escutar sem fechar a janela nem resolver (ex.: a tela foi destruída). */
  dispose(): void;
}

export interface OAuthSessionStartRequest {
  provider: string;
  /** Token da sessão hospedada do Delta Connect. */
  session: string;
  mode: ConnectionMode;
}

export const POPUP_BLOCKED_MESSAGE = 'Seu navegador bloqueou a janela de login; vamos continuar nesta aba.';

/**
 * Conexão de plataformas com um clique: abre o login da plataforma em outra janela e espera o
 * resultado pelos três canais do contrato (postMessage, BroadcastChannel e storage).
 *
 * Não usa popup.closed como sinal de desistência: a política COOP das páginas de login do
 * Google e da Meta corta o vínculo com a janela e faz `closed` virar true no meio do login.
 */
@Injectable({ providedIn: 'root' })
export class OAuthService {
  private readonly browser = inject(OAuthBrowser);
  private readonly toast = inject(DsToastService);

  /** Chame de forma SÍNCRONA no handler de clique (window.open fora do gesto é bloqueado). */
  start(request: OAuthStartRequest): OAuthFlow {
    const flow = newFlowId();
    const url = (returnTo: 'popup' | 'redirect') =>
      oauthStartUrl({ provider: request.provider, tenantId: request.tenantId, mode: request.mode, flow, returnTo });

    const popup = this.browser.open(url('popup'), OAUTH_WINDOW_NAME, popupFeatures(this.browser.geometry()));

    if (!popup) {
      this.toast.info('Janela de login bloqueada', { message: POPUP_BLOCKED_MESSAGE });
      this.browser.assign(url('redirect'));
      return {
        flow,
        via: 'redirect',
        result: new Promise<OAuthOutcome>(() => undefined), // a aba vai navegar; não há o que esperar
        cancel: () => undefined,
        dispose: () => undefined,
      };
    }

    popup.focus?.();
    return this.waitFor(flow, request.provider, popup);
  }

  /**
   * Delta Connect (ADR 0032): login pela sessão hospedada, para quem não tem conta no Delta.
   * Só pop-up: sem ele devolve null (o modo redirect volta para /integracoes, que exige login),
   * e a tela pede para permitir pop-ups. Chame de forma SÍNCRONA no handler de clique.
   */
  startSession(request: OAuthSessionStartRequest): OAuthFlow | null {
    const flow = newFlowId();
    const url = connectSessionStartUrl({ provider: request.provider, session: request.session, mode: request.mode, flow });
    const popup = this.browser.open(url, OAUTH_WINDOW_NAME, popupFeatures(this.browser.geometry()));
    if (!popup) return null;

    popup.focus?.();
    return this.waitFor(flow, request.provider, popup);
  }

  private waitFor(flow: string, provider: string, popup: OAuthPopup): OAuthFlow {
    const cleanups: (() => void)[] = [];
    let settled = false;
    let resolve!: (outcome: OAuthOutcome) => void;
    const result = new Promise<OAuthOutcome>((r) => (resolve = r));

    const stop = () => {
      while (cleanups.length) cleanups.pop()?.();
    };
    const settle = (outcome: OAuthOutcome) => {
      if (settled) return; // os três canais entregam a mesma mensagem: vale só a primeira
      settled = true;
      stop();
      resolve(outcome);
    };
    const accept = (data: unknown) => {
      const message = parseOAuthResult(data);
      if (message && message.flow === flow) {
        this.browser.removeStored(OAUTH_STORAGE_KEY);
        settle(outcomeFromMessage(message));
      }
    };

    // (a) postMessage do pop-up para esta janela (só da mesma origem)
    cleanups.push(
      this.browser.listen('message', (event) => {
        if (event.origin === this.browser.origin()) accept(event.data);
      }),
    );

    // (b) BroadcastChannel: funciona mesmo quando o COOP corta window.opener
    const channel = this.browser.channel(OAUTH_CHANNEL);
    if (channel) {
      channel.onmessage = (event) => accept(event.data);
      cleanups.push(() => channel.close());
    }

    // (c) evento "storage": a página de retorno grava a chave; outras abas recebem o evento
    cleanups.push(
      this.browser.listen('storage', (event) => {
        if (event.key !== OAUTH_STORAGE_KEY || !event.newValue) return;
        try {
          accept(JSON.parse(event.newValue));
        } catch {
          /* valor que não é JSON: não é nosso */
        }
      }),
    );

    const timer = setTimeout(
      () =>
        settle({
          status: 'timeout',
          provider,
          message: 'O tempo para autorizar acabou (10 minutos). Tente de novo.',
        }),
      OAUTH_TIMEOUT_MS,
    );
    cleanups.push(() => clearTimeout(timer));

    return {
      flow,
      via: 'popup',
      result,
      cancel: () => {
        try {
          if (!popup.closed) popup.close();
        } catch {
          /* janela inacessível (COOP): o usuário fecha por lá */
        }
        settle({ status: 'cancelled', provider, message: 'Conexão cancelada.' });
      },
      dispose: () => {
        settled = true;
        stop();
      },
    };
  }
}
