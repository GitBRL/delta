import { DOCUMENT } from '@angular/common';
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
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideCopy, LucideExternalLink, LucideKeyRound, LucideRefreshCw } from '@lucide/angular';
import { DsButton, DsGlassCard, DsSkeleton, DsStatusBadge, DsTextField, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ApiEnvelope,
  AppVendor,
  PlatformApp,
  PlatformAppResponse,
  PlatformAppVerification,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors, validationMessage } from '../../core/forms/server-errors';
import { relativeTime } from '../../core/format/relative-time';
import { TenantService } from '../../core/tenant/tenant.service';
import {
  EMPTY_APP_DRAFT,
  ID_LABEL,
  ID_PLACEHOLDER,
  PlatformAppDraft,
  SECRET_LABEL,
  SECRET_NOUN,
  SETUP_GUIDE,
  VENDOR_ICON,
  VENDOR_OF,
  VERIFIED_ON_FIRST_CONNECTION,
  appDraftFrom,
  appStatusMeta,
  buildAppBody,
  hasStoredSecret,
  joinNames,
  missingPlatformNames,
  validateAppDraft,
} from './platform-apps';
import { ProviderIcon } from './provider-icon';

/** Quanto tempo o card aberto pelo link (#meta, #google) fica destacado. */
export const TARGET_HIGHLIGHT_MS = 2400;

/**
 * Integrações › Apps das plataformas: dono/admin da agência cadastra as credenciais OAuth
 * (ID + chave secreta) dos apps da Meta, do Google, do TikTok e do LinkedIn. O segredo vai uma vez ao
 * servidor e nunca volta.
 */
@Component({
  selector: 'app-platform-apps-page',
  imports: [
    FormsModule,
    RouterLink,
    DsButton,
    DsGlassCard,
    DsSkeleton,
    DsStatusBadge,
    DsTextField,
    ProviderIcon,
    LucideArrowLeft,
    LucideCopy,
    LucideExternalLink,
    LucideKeyRound,
    LucideRefreshCw,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-apps.page.html',
  styleUrl: './platform-apps.page.css',
})
export class PlatformAppsPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  private readonly document = inject(DOCUMENT);
  protected readonly tenant = inject(TenantService);

  protected readonly statusOf = appStatusMeta;
  protected readonly secretLabel = SECRET_LABEL;
  protected readonly secretNoun = SECRET_NOUN;
  protected readonly guide = SETUP_GUIDE;
  protected readonly idLabel = ID_LABEL;
  protected readonly idPlaceholder = ID_PLACEHOLDER;
  protected readonly vendorIcon = VENDOR_ICON;
  protected readonly vendorOf = VENDOR_OF;
  protected readonly relativeTime = relativeTime;
  protected readonly joinNames = joinNames;
  protected readonly hasStoredSecret = hasStoredSecret;
  protected readonly missingPlatformNames = missingPlatformNames;

  /** Só dono/admin chega a chamar a API (os demais veem um aviso). */
  protected readonly apps = httpResource<ApiEnvelope<PlatformApp[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId && this.tenant.isAdmin()
      ? { url: API.platformApps, headers: { [TENANT_HEADER]: tenantId } }
      : undefined;
  });

  protected readonly appList = computed(() => (this.apps.hasValue() ? this.apps.value().data : []));

  /** Rascunho por vendor; recriado quando o app chega do servidor (sem segredos). */
  readonly drafts = signal<Partial<Record<AppVendor, PlatformAppDraft>>>({});
  readonly errors = signal<Partial<Record<AppVendor, FieldErrors>>>({});
  /** Resultado da última verificação feita nesta tela. */
  readonly results = signal<Partial<Record<AppVendor, PlatformAppVerification>>>({});
  readonly busy = signal<{ vendor: AppVendor; action: 'save' | 'verify' | 'remove' } | null>(null);
  readonly confirmingRemove = signal<AppVendor | null>(null);
  /** Card aberto por link (#meta / #google), destacado por alguns segundos. */
  readonly target = signal<AppVendor | null>(null);

  private readonly fragment = inject(ActivatedRoute).snapshot.fragment;
  private targetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Preenche o rascunho de quem ainda não tem um (não apaga o que a pessoa está digitando).
    effect(() => {
      const list = this.appList();
      untracked(() => {
        const current = this.drafts();
        const missing = list.filter((app) => !current[app.vendor]);
        if (missing.length === 0) return;
        this.drafts.set({ ...current, ...Object.fromEntries(missing.map((app) => [app.vendor, appDraftFrom(app)])) });
      });
    });

    // Vindo do botão bloqueado de Integrações: rola até o card do vendor e foca o primeiro campo.
    let scrolled = false;
    effect(() => {
      const vendor = this.fragment;
      if (scrolled || !vendor || !this.appList().some((app) => app.vendor === vendor)) return;
      scrolled = true;
      untracked(() => this.focusCard(vendor as AppVendor));
    });

    inject(DestroyRef).onDestroy(() => clearTimeout(this.targetTimer));
  }

  protected platformNames(app: PlatformApp): string {
    return joinNames(app.platforms.map((p) => p.name));
  }

  protected draftOf(vendor: AppVendor): PlatformAppDraft {
    return this.drafts()[vendor] ?? EMPTY_APP_DRAFT;
  }

  protected errorOf(vendor: AppVendor, field: string): string | null {
    return this.errors()[vendor]?.[field] ?? null;
  }

  protected patch(vendor: AppVendor, change: Partial<PlatformAppDraft>): void {
    this.drafts.update((all) => ({ ...all, [vendor]: { ...(all[vendor] ?? EMPTY_APP_DRAFT), ...change } }));
    const field = Object.keys(change)[0];
    if (field && this.errors()[vendor]?.[field]) {
      this.errors.update((all) => {
        const rest = { ...(all[vendor] ?? {}) };
        delete rest[field];
        return { ...all, [vendor]: rest };
      });
    }
  }

  protected isBusy(vendor: AppVendor, action?: 'save' | 'verify' | 'remove'): boolean {
    const busy = this.busy();
    return !!busy && busy.vendor === vendor && (!action || busy.action === action);
  }

  protected secretHint(app: PlatformApp): string {
    return hasStoredSecret(app)
      ? `Salva: ${app.client_secret_hint}. Deixe em branco para manter.`
      : 'Fica guardada criptografada e nunca é exibida de novo.';
  }

  protected tokenHint(app: PlatformApp): string {
    return app.developer_token_hint
      ? `Salvo: ${app.developer_token_hint}. Deixe em branco para manter.`
      : 'Opcional. Necessário só para conectar o Google Ads.';
  }

  /** "Salvar e verificar": envia, o servidor guarda criptografado e testa com a plataforma. */
  async save(app: PlatformApp): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId || this.busy()) return;

    const draft = this.draftOf(app.vendor);
    const clientErrors = validateAppDraft(app, draft);
    if (Object.keys(clientErrors).length > 0) {
      this.errors.update((all) => ({ ...all, [app.vendor]: clientErrors }));
      return;
    }

    this.errors.update((all) => ({ ...all, [app.vendor]: {} }));
    this.busy.set({ vendor: app.vendor, action: 'save' });
    try {
      const res = await firstValueFrom(
        this.http.put<PlatformAppResponse>(API.platformApp(app.vendor), buildAppBody(app, draft), {
          headers: { [TENANT_HEADER]: tenantId },
        }),
      );
      // O segredo não fica em memória depois de salvo.
      this.drafts.update((all) => ({ ...all, [app.vendor]: appDraftFrom(res.data) }));
      this.applyResponse(res, 'save');
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) {
        // 422: mantém o que foi digitado para a pessoa corrigir só o campo apontado.
        this.errors.update((all) => ({ ...all, [app.vendor]: fields }));
        if (Object.keys(fields).length === 0) {
          this.toast.error('Não foi possível salvar', { message: validationMessage(error) ?? undefined });
        }
      } else {
        this.patch(app.vendor, { client_secret: '', developer_token: '' });
        this.reportError(error, 'Não foi possível salvar');
      }
    } finally {
      this.busy.set(null);
    }
  }

  /** "Testar de novo": confere as credenciais salvas sem alterar nada. */
  async verify(app: PlatformApp): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId || this.busy()) return;

    this.busy.set({ vendor: app.vendor, action: 'verify' });
    try {
      const res = await firstValueFrom(
        this.http.post<PlatformAppResponse>(API.platformAppVerify(app.vendor), {}, {
          headers: { [TENANT_HEADER]: tenantId },
        }),
      );
      this.applyResponse(res, 'verify');
    } catch (error) {
      this.reportError(error, 'Não foi possível testar');
    } finally {
      this.busy.set(null);
    }
  }

  protected askRemove(vendor: AppVendor): void {
    this.confirmingRemove.set(vendor);
  }

  async remove(app: PlatformApp): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId || this.busy()) return;

    this.busy.set({ vendor: app.vendor, action: 'remove' });
    try {
      await firstValueFrom(this.http.delete(API.platformApp(app.vendor), { headers: { [TENANT_HEADER]: tenantId } }));
      this.toast.success(`App ${VENDOR_OF[app.vendor]} removido`, {
        message: 'O login real volta a depender das credenciais do servidor, se houver.',
      });
      this.drafts.update((all) => ({ ...all, [app.vendor]: { ...EMPTY_APP_DRAFT } }));
      this.results.update((all) => {
        const rest = { ...all };
        delete rest[app.vendor];
        return rest;
      });
      this.apps.reload(); // o novo estado (servidor ou não configurado) vem do backend
    } catch (error) {
      this.reportError(error, 'Não foi possível remover');
    } finally {
      this.busy.set(null);
      this.confirmingRemove.set(null);
    }
  }

  protected async copy(uri: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(uri);
      this.toast.success('Copiado', { message: uri });
    } catch {
      this.toast.error('Não foi possível copiar', { message: 'Selecione o endereço e copie manualmente.' });
    }
  }

  private applyResponse(res: PlatformAppResponse, action: 'save' | 'verify'): void {
    const app = res.data;
    this.apps.update((current) => ({
      data: (current?.data ?? []).map((item) => (item.vendor === app.vendor ? app : item)),
    }));
    this.results.update((all) => ({ ...all, [app.vendor]: res.verification }));

    const subject = `App ${VENDOR_OF[app.vendor]}`;
    const { status, message } = res.verification;
    if (status === 'verified') {
      this.toast.success(action === 'save' ? `${subject} salvo e verificado` : `${subject} verificado`, { message });
    } else if (status === 'invalid') {
      this.toast.error(`${app.name} recusou as credenciais`, { message });
    } else if (VERIFIED_ON_FIRST_CONNECTION.has(app.vendor)) {
      // Não é falha: a plataforma só confere o app quando um anunciante autoriza.
      this.toast.info(action === 'save' ? `${subject} salvo` : `${subject} será conferido na primeira conexão`, { message });
    } else {
      this.toast.info(action === 'save' ? `${subject} salvo, mas não verificado` : 'Não foi possível verificar agora', {
        message,
      });
    }
  }

  private focusCard(vendor: AppVendor): void {
    this.target.set(vendor);
    clearTimeout(this.targetTimer);
    this.targetTimer = setTimeout(() => this.target.set(null), TARGET_HIGHLIGHT_MS);
    // Depois do próximo render (o card acabou de aparecer).
    setTimeout(() => {
      const card = this.document.getElementById(`app-${vendor}`);
      card?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      card?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    });
  }

  private reportError(error: unknown, title: string): void {
    // 403/5xx/rede já viram toast no interceptor global.
    if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
      this.toast.error(title, { message: validationMessage(error) ?? undefined });
    }
  }
}
