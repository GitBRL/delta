import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { LucideCircleCheck, LucideCircleAlert } from '@lucide/angular';
import { DsButton, DsSkeleton } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, ConnectionMode, PublicConnectPlatform, PublicConnectSession } from '../../core/api/api.types';
import { OAuthFlow, OAuthService } from '../../core/oauth/oauth.service';
import { DeltaLogo } from '../auth/delta-logo';
import { CATEGORY_LABEL } from '../integrations/integration-labels';
import { ProviderIcon } from '../integrations/provider-icon';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: PublicConnectSession }
  | { kind: 'missing' }
  | { kind: 'error' };

/** Aviso exibido depois de uma tentativa de conexão (sucesso ou falha). */
interface Notice {
  level: 'success' | 'error';
  text: string;
}

export const POPUP_REQUIRED_MESSAGE =
  'Seu navegador bloqueou a janela de login. Permita pop-ups para este site e toque em "Conectar" de novo.';

/** Modo principal do botão: o real quando existe; senão, a demonstração. */
export function primaryMode(platform: PublicConnectPlatform): ConnectionMode | null {
  if (platform.modes.includes('live')) return 'live';
  return platform.modes.includes('sandbox') ? 'sandbox' : null;
}

/** Só leva de volta para http(s): nada de esquemas como javascript: vindos da sessão. */
export function safeReturnUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Sessão hospedada do Delta Connect (ADR 0032). Rota pública: /conectar/:token
 *
 * O cliente final de um SaaS (merchant) conecta as contas sem ter conta no Delta. O login de
 * cada plataforma usa o mesmo pop-up das Integrações, iniciado pela sessão
 * (/oauth/{p}/start?connect_session=…). Só pop-up: no modo redirect o backend volta para
 * /integracoes, que exige login. Mobile-first: o link pode ser aberto no celular.
 */
@Component({
  selector: 'app-connect-session-page',
  imports: [DsButton, DsSkeleton, DeltaLogo, ProviderIcon, LucideCircleCheck, LucideCircleAlert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" [style.--ds-accent]="brand()?.color ?? null">
      @switch (state().kind) {
        @case ('loading') {
          <div class="stack" aria-busy="true">
            <ds-skeleton width="40%" height="20px" />
            <ds-skeleton width="70%" height="28px" />
            <ds-skeleton height="72px" radius="var(--ds-radius-lg)" />
            <ds-skeleton height="72px" radius="var(--ds-radius-lg)" />
          </div>
        }
        @case ('missing') {
          <div class="state ds-glass" role="alert" data-testid="missing">
            <p class="m-0 text-headline">Link de conexão inválido</p>
            <p class="m-0 text-footnote text-fg-muted">Confira se o link foi copiado inteiro ou peça um novo a quem enviou.</p>
          </div>
        }
        @case ('error') {
          <div class="state ds-glass" role="alert">
            <p class="m-0 text-headline">Não foi possível abrir agora.</p>
            <button ds-button variant="secondary" size="sm" (click)="load()">Tentar de novo</button>
          </div>
        }
        @default {
          @if (data(); as d) {
            <header class="brand">
              @if (d.brand.logo_url) {
                <img class="logo" [src]="d.brand.logo_url" [alt]="d.brand.name" />
              } @else {
                <span class="agency text-subhead font-semibold">{{ d.brand.name }}</span>
              }
            </header>

            <div class="intro">
              <h1 class="m-0 text-title-2 font-bold">Conecte as contas de {{ d.customer.name }}</h1>
              <p class="m-0 text-footnote text-fg-muted">
                Toque em "Conectar" e entre na plataforma numa janela nova. Você não precisa de conta no Delta.
              </p>
            </div>

            @if (finished()) {
              <section class="answer ds-glass" role="status" data-testid="finished">
                <svg lucideCircleCheck [size]="28" aria-hidden="true"></svg>
                <p class="m-0 text-headline">Pronto! Você já pode fechar esta janela.</p>
              </section>
            } @else if (d.expired) {
              <section class="answer ds-glass" role="alert" data-testid="expired">
                <p class="m-0 text-headline">Este link expirou. Peça um novo a quem enviou.</p>
              </section>
            } @else {
              @if (popupBlocked()) {
                <p class="notice error" role="alert" data-testid="popup-blocked">
                  <svg lucideCircleAlert [size]="16" aria-hidden="true"></svg>
                  {{ popupMessage }}
                </p>
              }
              @if (notice(); as n) {
                <p class="notice" [class.error]="n.level === 'error'" [class.success]="n.level === 'success'" role="status" data-testid="notice">
                  {{ n.text }}
                </p>
              }

              <ul class="platforms" aria-label="Plataformas para conectar">
                @for (p of d.platforms; track p.key) {
                  <li class="platform ds-glass" [attr.data-testid]="'platform-' + p.key">
                    <div class="who">
                      <span class="icon"><app-provider-icon [provider]="p.key" [size]="20" /></span>
                      <div class="names">
                        <span class="text-headline">{{ p.name }}</span>
                        <span class="text-caption text-fg-muted">{{ category(p) }}</span>
                        @if (p.connected_accounts.length > 0) {
                          <span class="connected text-footnote" data-testid="connected">
                            <svg lucideCircleCheck [size]="14" aria-hidden="true"></svg>
                            Conectado: {{ p.connected_accounts.join(', ') }}
                          </span>
                        }
                      </div>
                    </div>
                    <div class="actions">
                      @switch (primary(p)) {
                        @case ('live') {
                          <button ds-button size="sm" [loading]="busy() === p.key" [disabled]="busy() !== null"
                            (click)="connect(p, 'live')">
                            {{ p.connected_accounts.length > 0 ? 'Conectar outra' : 'Conectar' }}
                          </button>
                          @if (p.modes.includes('sandbox')) {
                            <button ds-button size="sm" variant="ghost" [disabled]="busy() !== null" (click)="connect(p, 'sandbox')">
                              Usar demonstração
                            </button>
                          }
                        }
                        @case ('sandbox') {
                          <button ds-button size="sm" [loading]="busy() === p.key" [disabled]="busy() !== null"
                            (click)="connect(p, 'sandbox')">
                            Conectar (demonstração)
                          </button>
                        }
                        @default {
                          <span class="text-caption text-fg-muted">Indisponível no momento</span>
                        }
                      }
                    </div>
                  </li>
                }
              </ul>

              <div class="finish">
                @if (returnUrl(); as url) {
                  <a ds-button [href]="url" data-testid="finish">Concluir</a>
                } @else {
                  <button ds-button type="button" (click)="finished.set(true)" data-testid="finish">Concluir</button>
                }
                <p class="m-0 text-caption text-fg-muted">Link válido até {{ time(d.expires_at) }}.</p>
              </div>
            }
          }
        }
      }

      @if (!brand()?.hide_delta_badge) {
        <footer class="made">
          <app-delta-logo [size]="16" />
          Feito com Delta
        </footer>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
      background: var(--ds-bg);
      color: var(--ds-text);
    }
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
      max-width: 560px;
      margin: 0 auto;
      padding: var(--ds-space-6) var(--ds-space-4);
    }
    .stack,
    .intro {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .brand {
      display: flex;
      align-items: center;
      min-height: 36px;
    }
    .logo {
      max-width: 160px;
      max-height: 40px;
      object-fit: contain;
    }
    .agency {
      color: var(--ds-accent);
    }
    .platforms {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .platform {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-3);
      padding: var(--ds-space-4);
      border-radius: var(--ds-radius-lg);
    }
    .who {
      display: flex;
      align-items: center;
      gap: var(--ds-space-3);
      min-width: 0;
    }
    .icon {
      display: grid;
      place-items: center;
      flex: none;
      width: 40px;
      height: 40px;
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
      color: var(--ds-accent);
    }
    .names {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .connected {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--ds-status-healthy);
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-2);
      margin-left: auto;
    }
    .actions button {
      min-height: 44px;
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
      font: var(--ds-text-footnote);
    }
    .notice.error {
      color: var(--ds-status-critical);
    }
    .notice.success {
      color: var(--ds-status-healthy);
    }
    .finish {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: var(--ds-space-2);
      text-align: center;
    }
    .finish a,
    .finish button {
      min-height: 44px;
    }
    .answer,
    .state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--ds-space-3);
      padding: var(--ds-space-5) var(--ds-space-4);
      border-radius: var(--ds-radius-xl);
      text-align: center;
    }
    .answer svg {
      color: var(--ds-status-healthy);
    }
    .state {
      margin-top: 10vh;
    }
    .made {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: var(--ds-space-4);
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
  `,
})
export class ConnectSessionPage implements OnInit {
  readonly token = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly oauth = inject(OAuthService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly popupMessage = POPUP_REQUIRED_MESSAGE;
  protected readonly primary = primaryMode;

  readonly state = signal<State>({ kind: 'loading' });
  /** Plataforma com login em andamento. */
  readonly busy = signal<string | null>(null);
  readonly notice = signal<Notice | null>(null);
  readonly popupBlocked = signal(false);
  readonly finished = signal(false);

  private current: OAuthFlow | null = null;

  protected readonly data = computed(() => {
    const s = this.state();
    return s.kind === 'ready' ? s.data : null;
  });
  protected readonly brand = computed(() => this.data()?.brand ?? null);
  protected readonly returnUrl = computed(() => safeReturnUrl(this.data()?.return_url ?? null));

  ngOnInit(): void {
    // Tema claro para quem recebe o link, sem mexer na preferência salva de quem usa o Delta.
    const root = this.document.documentElement;
    const previous = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    this.destroyRef.onDestroy(() => {
      this.current?.dispose();
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    });
    void this.load();
  }

  async load(quiet = false): Promise<void> {
    if (!quiet) this.state.set({ kind: 'loading' });
    try {
      const res = await firstValueFrom(this.http.get<ApiEnvelope<PublicConnectSession>>(API.publicConnect(this.token())));
      this.state.set({ kind: 'ready', data: res.data });
    } catch (error) {
      this.state.set({ kind: error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error' });
    }
  }

  /** Síncrono até abrir o pop-up: fora do gesto de clique o navegador bloqueia a janela. */
  connect(platform: PublicConnectPlatform, mode: ConnectionMode): void {
    if (this.busy() !== null) return;
    this.notice.set(null);

    const flow = this.oauth.startSession({ provider: platform.key, session: this.token(), mode });
    if (flow === null) {
      this.popupBlocked.set(true);
      return;
    }

    this.popupBlocked.set(false);
    this.busy.set(platform.key);
    this.current = flow;
    void flow.result.then(async (outcome) => {
      this.current = null;
      if (outcome.status === 'success') {
        await this.load(true);
        this.notice.set({ level: 'success', text: `${platform.name} conectado.` });
      } else if (outcome.status === 'cancelled') {
        this.notice.set({ level: 'error', text: outcome.message ?? 'Conexão cancelada.' });
      } else {
        this.notice.set({ level: 'error', text: outcome.message ?? `Não foi possível conectar ${platform.name}. Tente de novo.` });
      }
      this.busy.set(null);
    });
  }

  protected category(platform: PublicConnectPlatform): string {
    return CATEGORY_LABEL[platform.category] ?? '';
  }

  protected time(iso: string): string {
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }
}
