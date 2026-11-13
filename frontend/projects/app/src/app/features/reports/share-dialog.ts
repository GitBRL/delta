import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { LucideCopy, LucideLock, LucideX } from '@lucide/angular';
import { DsButton, DsSkeleton, DsToastService } from 'design-system';
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

export const VALIDITY_OPTIONS: readonly { days: number | null; label: string }[] = [
  { days: null, label: 'Sem validade' },
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
];

const DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Situação de um link para exibir. */
export function linkState(link: ShareLink, now = new Date()): string {
  if (link.revoked_at) return 'Desativado';
  if (link.expires_at && new Date(link.expires_at) <= now) return 'Expirado';
  return link.expires_at ? `Válido até ${DATE.format(new Date(link.expires_at))}` : 'Sem validade';
}

/**
 * Compartilhar uma versão publicada por link público: senha e validade opcionais.
 * O link só aparece na criação (o backend guarda o hash), então mostramos com "Copiar".
 */
@Component({
  selector: 'app-share-dialog',
  imports: [DsButton, DsSkeleton, LucideCopy, LucideLock, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'dismissed.emit()' },
  template: `
    <div class="backdrop" (click)="dismissed.emit()" aria-hidden="true"></div>
    <section class="panel ds-glass" role="dialog" aria-modal="true" aria-labelledby="share-title" animate.enter="ds-enter-fade-up">
      <header class="head">
        <div>
          <h2 id="share-title" class="m-0 text-title-3 font-semibold">Compartilhar</h2>
          <p class="m-0 text-footnote text-fg-muted">{{ title() }}</p>
        </div>
        <button type="button" class="close" (click)="dismissed.emit()" aria-label="Fechar">
          <svg lucideX [size]="18"></svg>
        </button>
      </header>

      <form class="form" aria-label="Novo link" (submit)="$event.preventDefault(); create()">
        <label class="field">
          <span>Senha (opcional)</span>
          <input
            type="password"
            name="share_password"
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
          <select name="share_validity" (change)="setValidity($any($event.target).value)">
            @for (o of validityOptions; track o.label) {
              <option [value]="o.days ?? ''" [selected]="o.days === validity()">{{ o.label }}</option>
            }
          </select>
        </label>
        <button ds-button type="submit" [loading]="creating()">
          Criar link
        </button>
      </form>

      @if (createdUrl(); as url) {
        <div class="created" role="status" animate.enter="ds-enter-fade-up">
          <p class="m-0 text-footnote font-semibold">Link criado. Ele só aparece agora: copie e envie ao cliente.</p>
          <div class="url-row">
            <input class="url" type="text" readonly [value]="url" aria-label="Link do relatório" (focus)="$any($event.target).select()" />
            <button ds-button variant="secondary" size="sm" type="button" (click)="copy(url)">
              <svg lucideCopy [size]="14"></svg>
              Copiar
            </button>
          </div>
        </div>
      }

      <h3 class="m-0 text-headline">Links desta versão</h3>
      @if (links.isLoading() && !links.hasValue()) {
        <ds-skeleton width="70%" />
      } @else if (linkList().length === 0) {
        <p class="m-0 text-footnote text-fg-muted">Nenhum link ainda.</p>
      } @else {
        <ul class="links">
          @for (link of linkList(); track link.id) {
            <li class="link" [attr.data-link]="link.id" [class.inactive]="!link.active">
              <span class="state">
                @if (link.protected) {
                  <svg lucideLock [size]="14" aria-label="Protegido por senha"></svg>
                }
                {{ linkState(link) }}
              </span>
              <span class="views">
                {{ link.view_count }} {{ link.view_count === 1 ? 'visualização' : 'visualizações' }}
                @if (link.last_viewed_at) {
                  · última {{ relativeTime(link.last_viewed_at) }}
                }
              </span>
              @if (link.active) {
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
    :host {
      position: fixed;
      inset: 0;
      z-index: var(--ds-z-overlay, 50);
      display: grid;
      place-items: center;
      padding: var(--ds-space-4);
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgb(0 0 0 / 0.35);
      backdrop-filter: blur(4px);
    }
    .panel {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
      width: min(560px, 100%);
      max-height: calc(100vh - 32px);
      overflow: auto;
      padding: var(--ds-space-6);
      border-radius: var(--ds-radius-xl);
    }
    .head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--ds-space-3);
    }
    .close {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 50%;
      background: var(--ds-fill);
      color: var(--ds-text-secondary);
      cursor: pointer;
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
      gap: var(--ds-space-2);
    }
    .url {
      flex: 1;
      min-width: 0;
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
      gap: 4px;
      font-weight: 600;
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
export class ShareDialog {
  readonly snapshotId = input.required<string>();
  readonly title = input('');
  readonly dismissed = output<void>();
  /** Um link foi criado ou desativado (quem abriu pode atualizar a contagem). */
  readonly changed = output<void>();

  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  private readonly tenant = inject(TenantService);

  protected readonly validityOptions = VALIDITY_OPTIONS;
  protected readonly linkState = linkState;
  protected readonly relativeTime = relativeTime;

  protected readonly password = signal('');
  protected readonly passwordError = signal<string | null>(null);
  protected readonly validity = signal<number | null>(30);
  protected readonly creating = signal(false);
  protected readonly revoking = signal<string | null>(null);
  readonly createdUrl = signal<string | null>(null);

  protected readonly links = httpResource<ApiEnvelope<ShareLink[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url: API.snapshotLinks(this.snapshotId()), headers: { [TENANT_HEADER]: tenantId } } : undefined;
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
        this.http.post<CreateShareLinkResponse>(API.snapshotLinks(this.snapshotId()), body, {
          headers: { [TENANT_HEADER]: tenantId },
        }),
      );
      this.createdUrl.set(res.url);
      this.password.set('');
      this.links.reload();
      this.changed.emit();
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
      this.toast.success('Link desativado', { message: 'Quem tiver o endereço não consegue mais abrir.' });
      this.links.reload();
      this.changed.emit();
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
