import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DsButton, DsIcon, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ApiEnvelope,
  CreateShareLinkBody,
  CreateShareLinkResponse,
  ShareLink,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { extractFieldErrors } from '../../core/forms/server-errors';
import { relativeTime } from '../../core/format/relative-time';
import { TenantService } from '../../core/tenant/tenant.service';
import { VALIDITY_OPTIONS, linkState } from './share-dialog';

/** "https://…/r/abc" → "https://…/r/abc?tv=1" */
export function tvUrl(url: string): string {
  return url.includes('?') ? `${url}&tv=1` : `${url}?tv=1`;
}

/**
 * Dashboard ao vivo: link público do RELATÓRIO (não de uma versão), recalculado a cada acesso
 * com cache de 5 minutos. Bom para a TV da agência ou para o cliente acompanhar o mês.
 * Sem PDF (os números mudam); para enviar um retrato fixo, publique uma versão.
 */
@Component({
  selector: 'app-live-links',
  imports: [DsButton, DsIcon, DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="live ds-glass" aria-labelledby="live-title">
      <header>
        <h2 id="live-title" class="m-0 text-title-3 font-semibold">Dashboard ao vivo</h2>
        <p class="m-0 mt-1 text-footnote text-fg-muted">
          Um link que mostra os números atuais deste relatório (recalculados a cada 5 minutos), com
          o período relativo de sempre. Ideal para a TV da agência ou para o cliente acompanhar o mês.
          Para enviar um retrato que não muda, publique uma versão.
        </p>
      </header>

      @if (canManage()) {
        <form class="form" aria-label="Novo link ao vivo" (submit)="$event.preventDefault(); create()">
          <label class="field">
            <span>Senha (opcional)</span>
            <input
              type="password"
              name="live_password"
              autocomplete="new-password"
              placeholder="Sem senha: qualquer pessoa com o link vê"
              [value]="password()"
              (input)="password.set($any($event.target).value); passwordError.set(null)"
            />
            @if (passwordError()) {
              <small class="error" role="alert">{{ passwordError() }}</small>
            }
          </label>
          <label class="field">
            <span>Validade</span>
            <select name="live_validity" (change)="setValidity($any($event.target).value)">
              @for (o of validityOptions; track o.label) {
                <option [value]="o.days ?? ''" [selected]="o.days === validity()">{{ o.label }}</option>
              }
            </select>
          </label>
          <button ds-button type="submit" [loading]="creating()">Criar link ao vivo</button>
        </form>
      }

      @if (createdUrl(); as url) {
        <div class="created" role="status">
          <p class="m-0 text-footnote font-semibold">Link criado. Ele só aparece agora: copie e guarde.</p>
          <div class="url-row">
            <input class="url" type="text" readonly [value]="url" aria-label="Link do dashboard ao vivo" (focus)="$any($event.target).select()" />
            <button ds-button variant="secondary" size="sm" type="button" (click)="copy(url)">Copiar</button>
            <a ds-button variant="ghost" size="sm" [href]="tvUrl(url)" target="_blank" rel="noopener">
              <svg dsIcon="tv" [size]="14"></svg>
              Abrir modo TV
            </a>
          </div>
        </div>
      }

      <h3 class="m-0 text-headline">Links ao vivo</h3>
      @if (links.isLoading() && !links.hasValue()) {
        <ds-skeleton width="70%" />
      } @else if (linkList().length === 0) {
        <p class="m-0 text-footnote text-fg-muted">Nenhum link ao vivo ainda.</p>
      } @else {
        <ul class="links">
          @for (link of linkList(); track link.id) {
            <li class="link" [attr.data-link]="link.id" [class.inactive]="!link.active">
              <span class="state">
                @if (link.active) {
                  <span class="dot" aria-hidden="true"></span>
                }
                {{ link.protected ? '🔒 ' : '' }}{{ linkState(link) }}
              </span>
              <span class="views">
                {{ link.view_count }} {{ link.view_count === 1 ? 'visualização' : 'visualizações' }}
                @if (link.last_viewed_at) {
                  · última {{ relativeTime(link.last_viewed_at) }}
                }
              </span>
              @if (link.active && canManage()) {
                <button ds-button variant="ghost" size="sm" type="button" [loading]="revoking() === link.id" (click)="revoke(link)">
                  Desativar
                </button>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .live {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
      padding: var(--ds-space-6);
      border-radius: var(--ds-radius-xl);
    }
    .form {
      display: grid;
      grid-template-columns: 1fr 160px;
      align-items: end;
      gap: var(--ds-space-3);
    }
    .form button {
      grid-column: 1 / -1;
      justify-self: start;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .field input,
    .field select,
    .url {
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
    }
    .error {
      color: var(--ds-status-critical);
      font-weight: 500;
    }
    .created {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-accent-soft, var(--ds-fill));
    }
    .url-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-2);
    }
    .url {
      flex: 1;
      min-width: 200px;
      font-family: var(--ds-font-mono);
    }
    .links {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .link {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-3);
      padding: var(--ds-space-2) var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
      font: var(--ds-text-footnote);
    }
    .link.inactive {
      opacity: 0.6;
    }
    .state {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--ds-status-healthy);
    }
    .views {
      flex: 1;
      color: var(--ds-text-secondary);
    }
    @media (max-width: 520px) {
      .form {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class LiveLinks {
  readonly reportId = input.required<string>();
  readonly canManage = input(true);

  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  private readonly tenant = inject(TenantService);

  protected readonly validityOptions = VALIDITY_OPTIONS;
  protected readonly linkState = linkState;
  protected readonly relativeTime = relativeTime;
  protected readonly tvUrl = tvUrl;

  protected readonly password = signal('');
  protected readonly passwordError = signal<string | null>(null);
  protected readonly validity = signal<number | null>(null);
  protected readonly creating = signal(false);
  protected readonly revoking = signal<string | null>(null);
  readonly createdUrl = signal<string | null>(null);

  protected readonly links = httpResource<ApiEnvelope<ShareLink[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url: API.reportLinks(this.reportId()), headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });
  protected readonly linkList = computed(() => (this.links.hasValue() ? this.links.value().data : []));

  protected setValidity(value: string): void {
    this.validity.set(value === '' ? null : Number(value));
  }

  async create(): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId || this.creating()) return;

    const password = this.password().trim();
    if (password && password.length < 4) {
      this.passwordError.set('A senha do link precisa de pelo menos 4 caracteres.');
      return;
    }

    const body: CreateShareLinkBody = { expires_in_days: this.validity(), password: password || null };
    this.creating.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<CreateShareLinkResponse>(API.reportLinks(this.reportId()), body, {
          headers: { [TENANT_HEADER]: tenantId },
        }),
      );
      this.createdUrl.set(res.url);
      this.password.set('');
      this.links.reload();
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) {
        this.passwordError.set(fields['password'] ?? fields['expires_in_days'] ?? 'Verifique os dados.');
      } else if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
        this.toast.error('Não foi possível criar o link');
      }
    } finally {
      this.creating.set(false);
    }
  }

  async revoke(link: ShareLink): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId) return;
    this.revoking.set(link.id);
    try {
      await firstValueFrom(this.http.delete(API.shareLink(link.id), { headers: { [TENANT_HEADER]: tenantId } }));
      this.toast.success('Link desativado', { message: 'A tela que usava este link para de atualizar.' });
      this.links.reload();
    } catch {
      /* 403/5xx: toast no interceptor */
    } finally {
      this.revoking.set(null);
    }
  }

  protected async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.toast.success('Link copiado');
    } catch {
      this.toast.info('Copie o link manualmente', { message: url });
    }
  }
}
