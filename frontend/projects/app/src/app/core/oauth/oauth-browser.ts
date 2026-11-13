import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { WindowGeometry } from './oauth-flow';

/** O que o fluxo precisa da janela aberta. */
export interface OAuthPopup {
  readonly closed: boolean;
  close(): void;
  focus?(): void;
}

export interface OAuthChannel {
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

/**
 * Acesso ao navegador usado pelo fluxo OAuth, isolado para os testes trocarem por um falso
 * (jsdom não navega nem abre janelas).
 */
@Injectable({ providedIn: 'root' })
export class OAuthBrowser {
  private readonly window = inject(DOCUMENT).defaultView as Window;

  /** Tem de ser chamado de forma síncrona no clique, senão o navegador bloqueia o pop-up. */
  open(url: string, name: string, features: string): OAuthPopup | null {
    return this.window.open(url, name, features);
  }

  /** Continua o fluxo nesta aba (pop-up bloqueado). */
  assign(url: string): void {
    this.window.location.assign(url);
  }

  origin(): string {
    return this.window.location.origin;
  }

  geometry(): WindowGeometry {
    return {
      screenX: this.window.screenX,
      screenY: this.window.screenY,
      outerWidth: this.window.outerWidth,
      outerHeight: this.window.outerHeight,
    };
  }

  channel(name: string): OAuthChannel | null {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null;
  }

  listen<K extends 'message' | 'storage'>(type: K, handler: (event: WindowEventMap[K]) => void): () => void {
    this.window.addEventListener(type, handler);
    return () => this.window.removeEventListener(type, handler);
  }

  removeStored(key: string): void {
    try {
      this.window.localStorage.removeItem(key);
    } catch {
      /* armazenamento indisponível: nada a limpar */
    }
  }
}
