import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideKeyRound, LucideLock, LucideRefreshCw, LucideSparkles } from '@lucide/angular';
import { DsButton, DsGlassCard, DsSkeleton, DsStatusBadge, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, Connection, ConnectionMode, Provider, TENANT_HEADER } from '../../core/api/api.types';
import { extractFieldErrors, validationMessage } from '../../core/forms/server-errors';
import { relativeTime } from '../../core/format/relative-time';
import { OAUTH_QUERY_KEYS, OAuthOutcome, parseOAuthQuery } from '../../core/oauth/oauth-flow';
import { OAuthFlow, OAuthService } from '../../core/oauth/oauth.service';
import { pollWhile } from '../../core/polling/poll-while';
import { TenantService } from '../../core/tenant/tenant.service';
import {
  ACCOUNT_KIND_LABEL,
  CATEGORY_LABEL,
  connectionStatus,
  hasSyncing,
  upsertConnection,
} from './integration-labels';
import { ProviderIcon } from './provider-icon';

/** Intervalo de atualização enquanto alguma conexão está sincronizando. */
export const SYNC_POLL_MS = 3000;
/** Quanto tempo a conexão recém-criada fica destacada na lista. */
export const HIGHLIGHT_MS = 4000;

export const LIVE_FALLBACK_NOTE = 'Aguardando aprovação da plataforma';

type CardState = 'idle' | 'authorizing' | 'syncing' | 'connected';

interface PendingFlow {
  provider: string;
  mode: ConnectionMode;
  flow: OAuthFlow;
}

interface CardMessage {
  kind: 'error' | 'info';
  text: string;
}

@Component({
  selector: 'app-integrations-page',
  imports: [
    RouterLink,
    DsButton,
    DsGlassCard,
    DsSkeleton,
    DsStatusBadge,
    ProviderIcon,
    LucideKeyRound,
    LucideLock,
    LucideRefreshCw,
    LucideSparkles,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './integrations.page.html',
  styleUrl: './integrations.page.css',
})
export class IntegrationsPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  private readonly oauth = inject(OAuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly tenant = inject(TenantService);

  protected readonly categoryLabel = CATEGORY_LABEL;
  protected readonly kindLabel = ACCOUNT_KIND_LABEL;
  protected readonly statusOf = connectionStatus;
  protected readonly relativeTime = relativeTime;

  private readonly tenantRequest = (url: string) => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  };

  /** Por agência: o login real depende dos apps que a agência cadastrou. */
  protected readonly providers = httpResource<ApiEnvelope<Provider[]>>(() => this.tenantRequest(API.providers));

  protected readonly connections = httpResource<ApiEnvelope<Connection[]>>(() => this.tenantRequest(API.connections));

  protected readonly providerList = computed(() => (this.providers.hasValue() ? this.providers.value().data : []));
  protected readonly connectionList = computed(() =>
    this.connections.hasValue() ? this.connections.value().data : [],
  );
  readonly syncing = computed(() => hasSyncing(this.connectionList()));

  protected readonly providerName = computed(() => {
    const names = new Map(this.providerList().map((p) => [p.key, p.name]));
    return (key: string) => names.get(key) ?? key;
  });

  /** Fluxo de autorização em andamento (um por vez). */
  readonly pending = signal<PendingFlow | null>(null);
  /** Conexão recém-criada, destacada por alguns segundos. */
  readonly highlightId = signal<string | null>(null);
  /** Mensagem de erro/cancelamento exibida no card de cada plataforma. */
  readonly cardMessages = signal<Readonly<Record<string, CardMessage>>>({});
  protected readonly syncRequested = signal<ReadonlySet<string>>(new Set());

  protected readonly canManage = computed(() => this.tenant.current()?.role !== 'client');

  /** Estado de cada card: autorizando (pop-up aberto), sincronizando, conectado ou livre. */
  protected readonly providerState = computed(() => {
    const byProvider = new Map<string, 'syncing' | 'connected'>();
    for (const c of this.connectionList()) {
      if (c.status === 'syncing') byProvider.set(c.provider, 'syncing');
      else if (c.status === 'active' && !byProvider.has(c.provider)) byProvider.set(c.provider, 'connected');
    }
    const pending = this.pending();
    return (key: string): CardState => (pending?.provider === key ? 'authorizing' : (byProvider.get(key) ?? 'idle'));
  });

  /** Resultado do modo redirect (?oauth=...), aplicado quando os nomes das plataformas chegam. */
  private readonly redirectOutcome = signal<OAuthOutcome | null>(null);
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    pollWhile(
      () => this.syncing(),
      () => {
        if (!this.connections.isLoading()) this.connections.reload();
      },
      SYNC_POLL_MS,
    );

    const query = this.route.snapshot.queryParamMap;
    const outcome = parseOAuthQuery((key) => query.get(key));
    if (outcome) {
      this.redirectOutcome.set(outcome);
      const cleared = Object.fromEntries(OAUTH_QUERY_KEYS.map((key) => [key, null]));
      void this.router.navigate([], { queryParams: cleared, queryParamsHandling: 'merge', replaceUrl: true });
    }

    effect(() => {
      const outcome = this.redirectOutcome();
      if (!outcome || !(this.providers.hasValue() || this.providers.error())) return;
      untracked(() => {
        this.redirectOutcome.set(null);
        this.applyOutcome(outcome, null); // no modo redirect não sabemos o modo; mensagem genérica
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.pending()?.flow.dispose();
      clearTimeout(this.highlightTimer);
    });
  }

  /** Clique em "Conectar demonstração" ou "Conectar conta real": abre o login em outra janela. */
  connect(provider: Provider, mode: ConnectionMode): void {
    const tenantId = this.tenant.currentId();
    if (!tenantId || this.pending() || !this.canManage()) return;

    if (mode === 'live' && !provider.available_modes.includes('live')) {
      this.liveUnavailable(provider);
      return;
    }

    this.clearMessage(provider.key);
    // Síncrono no clique: window.open fora do gesto do usuário é bloqueado pelo navegador.
    const flow = this.oauth.start({ provider: provider.key, tenantId, mode });
    if (flow.via === 'redirect') return; // a aba atual segue para o login

    this.pending.set({ provider: provider.key, mode, flow });
    void flow.result.then((outcome) => {
      if (this.pending()?.flow !== flow) return;
      this.pending.set(null);
      this.applyOutcome(outcome, mode);
    });
  }

  cancelPending(): void {
    this.pending()?.flow.cancel();
  }

  protected liveNote(provider: Provider): string {
    return provider.live_note || LIVE_FALLBACK_NOTE;
  }

  /**
   * Conta real com acesso expirado (ou perto disso): abre o mesmo pop-up de login da plataforma.
   * O login novo atualiza a conexão e a coleta volta sozinha.
   */
  reconnect(connection: Connection): void {
    const provider = this.providerList().find((p) => p.key === connection.provider);
    if (!provider) return;
    this.connect(provider, 'live');
  }

  /** "O acesso expira em 5 dias" (ou "hoje"/"amanhã"). */
  protected expiringText(connection: Connection, now: Date = new Date()): string {
    if (!connection.expires_at) return 'O acesso desta conta expira em breve.';
    const days = Math.ceil((new Date(connection.expires_at).getTime() - now.getTime()) / 86_400_000);
    if (days <= 0) return 'O acesso desta conta expira hoje.';
    if (days === 1) return 'O acesso desta conta expira amanhã.';
    return `O acesso desta conta expira em ${days} dias.`;
  }

  protected liveAvailable(provider: Provider): boolean {
    return provider.available_modes.includes('live');
  }

  /** Login real bloqueado: admin vai direto ao app que falta; os demais recebem a explicação. */
  protected liveUnavailable(provider: Provider): void {
    if (this.tenant.isAdmin() && provider.app_vendor) {
      void this.router.navigate(['/integracoes/apps'], { fragment: provider.app_vendor });
      return;
    }
    const note = this.liveNote(provider);
    this.toast.info('Conexão real indisponível', {
      message: `${provider.name}: ${note}${/[.!?]$/.test(note) ? '' : '.'}`,
    });
  }

  protected async syncNow(connection: Connection): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId || this.syncRequested().has(connection.id)) return;

    this.syncRequested.update((set) => new Set(set).add(connection.id));
    try {
      const res = await firstValueFrom(
        this.http.post<ApiEnvelope<Connection>>(API.connectionSync(connection.id), {}, {
          headers: { [TENANT_HEADER]: tenantId },
        }),
      );
      this.connections.update((current) => ({ data: upsertConnection(current?.data ?? [], res.data) }));
    } catch (error) {
      this.reportError(error, 'Não foi possível sincronizar');
    } finally {
      this.syncRequested.update((set) => {
        const next = new Set(set);
        next.delete(connection.id);
        return next;
      });
    }
  }

  private applyOutcome(outcome: OAuthOutcome, mode: ConnectionMode | null): void {
    const name = this.providerName()(outcome.provider);

    switch (outcome.status) {
      case 'success':
        this.toast.success(`${name} conectado`, {
          message:
            outcome.message ??
            (mode === 'sandbox'
              ? 'Dados de demonstração sendo gerados. Isso leva alguns segundos.'
              : mode === 'live'
                ? 'Contas encontradas. A primeira sincronização já começou.'
                : 'A primeira sincronização já começou.'),
        });
        this.connections.reload();
        if (outcome.connectionId) this.highlight(outcome.connectionId);
        break;
      case 'error':
        this.setMessage(outcome.provider, { kind: 'error', text: outcome.message ?? 'Não foi possível conectar.' });
        this.toast.error(`Não foi possível conectar ${name}`, { message: outcome.message });
        break;
      case 'cancelled':
        this.setMessage(outcome.provider, { kind: 'info', text: outcome.message ?? 'Conexão cancelada.' });
        break;
      case 'timeout':
        this.setMessage(outcome.provider, {
          kind: 'error',
          text: outcome.message ?? 'O tempo para autorizar acabou. Tente de novo.',
        });
        break;
    }
  }

  private highlight(connectionId: string): void {
    clearTimeout(this.highlightTimer);
    this.highlightId.set(connectionId);
    this.highlightTimer = setTimeout(() => this.highlightId.set(null), HIGHLIGHT_MS);
  }

  private setMessage(provider: string, message: CardMessage): void {
    this.cardMessages.update((all) => ({ ...all, [provider]: message }));
  }

  private clearMessage(provider: string): void {
    this.cardMessages.update((all) => {
      if (!(provider in all)) return all;
      const next = { ...all };
      delete next[provider];
      return next;
    });
  }

  private reportError(error: unknown, title: string): void {
    const fields = extractFieldErrors(error);
    if (fields) {
      this.toast.error(title, {
        message: Object.values(fields)[0] ?? validationMessage(error) ?? 'Verifique os dados e tente de novo.',
      });
      return;
    }
    // 403/5xx/rede já viram toast no interceptor global.
    if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
      this.toast.error(title);
    }
  }
}
