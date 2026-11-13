import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucidePlus } from '@lucide/angular';
import { DsButton, DsSkeleton } from 'design-system';
import { API, ApiEnvelope, Post, TENANT_HEADER } from '../../core/api/api.types';
import { TenantService } from '../../core/tenant/tenant.service';
import { ProviderIcon } from '../integrations/provider-icon';
import { STATUS_TEXT, dayKey, formatDateTime, postDate, statusTone } from './publishing';

/** Quantas publicações o card do projeto mostra. */
export const NEXT_POSTS = 5;

/** Próximas publicações do projeto (o cliente também vê: são as dele). */
@Component({
  selector: 'app-project-posts',
  imports: [RouterLink, DsButton, DsSkeleton, ProviderIcon, LucidePlus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h2 class="m-0 text-headline">Próximas publicações</h2>
      @if (canManage()) {
        <a class="new" routerLink="/publicacoes/novo" [queryParams]="{ projeto: projectId() }">
          <svg lucidePlus [size]="14"></svg>
          Novo
        </a>
      }
    </div>
    @if (posts.isLoading() && !posts.hasValue()) {
      <ds-skeleton width="80%" />
      <ds-skeleton width="60%" />
    } @else if (posts.error()) {
      <p class="m-0 text-footnote text-fg-muted" role="alert">
        Não foi possível carregar as publicações.
        <button ds-button variant="ghost" size="sm" (click)="posts.reload()">Tentar de novo</button>
      </p>
    } @else if (next().length === 0) {
      <p class="m-0 text-footnote text-fg-muted">
        {{ canManage() ? 'Nada agendado. Crie um post e peça a aprovação do cliente por link.' : 'A agência ainda não preparou publicações.' }}
      </p>
    } @else {
      <ul class="list">
        @for (p of next(); track p.id) {
          <li>
            <a class="item" [routerLink]="['/publicacoes', p.id]" [attr.data-post]="p.id">
              <span class="nets" aria-hidden="true">
                @for (t of p.targets; track t.id) {
                  <app-provider-icon [provider]="t.network" [size]="14" />
                }
              </span>
              <span class="text">
                <strong>{{ p.title || 'Post sem título' }}</strong>
                <small>{{ when(p) }}</small>
              </span>
              <span class="status" [attr.data-tone]="tone(p.status)">{{ statusText[p.status] }}</span>
            </a>
          </li>
        }
      </ul>
    }
    <a class="all text-footnote" routerLink="/publicacoes" [queryParams]="{ projeto: projectId() }">Ver o calendário do projeto</a>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .new,
    .all {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--ds-accent);
      font-weight: 600;
      text-decoration: none;
    }
    .new {
      font: var(--ds-text-footnote);
      font-weight: 600;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      align-items: center;
      gap: var(--ds-space-3);
      padding: var(--ds-space-2);
      border-radius: var(--ds-radius-md);
      color: inherit;
      text-decoration: none;
    }
    .item:hover {
      background: var(--ds-fill);
    }
    .nets {
      display: inline-flex;
      flex: none;
      gap: 2px;
      color: var(--ds-text-secondary);
    }
    .text {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
    }
    .text strong {
      overflow: hidden;
      font: var(--ds-text-subhead);
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .text small {
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
    .status {
      flex: none;
      padding: 2px 8px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-fill);
      color: var(--ds-text-secondary);
      font: var(--ds-text-caption);
      font-weight: 600;
    }
    .status[data-tone='accent'] {
      color: var(--ds-accent);
    }
    .status[data-tone='attention'] {
      color: var(--ds-status-attention);
    }
    .status[data-tone='healthy'] {
      color: var(--ds-status-healthy);
    }
    .status[data-tone='critical'] {
      color: var(--ds-status-critical);
    }
  `,
})
export class ProjectPosts {
  readonly projectId = input.required<string>();

  private readonly tenant = inject(TenantService);
  protected readonly statusText = STATUS_TEXT;
  protected readonly tone = statusTone;

  protected readonly canManage = computed(() => this.tenant.current()?.role !== 'client');
  /** A partir de hoje (fuso do navegador). */
  private readonly from = dayKey(new Date());

  protected readonly posts = httpResource<ApiEnvelope<Post[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId
      ? { url: API.posts, params: { project_id: this.projectId(), from: this.from }, headers: { [TENANT_HEADER]: tenantId } }
      : undefined;
  });
  /** Próximas: sem as canceladas, na ordem da data. */
  protected readonly next = computed(() =>
    (this.posts.hasValue() ? this.posts.value().data : [])
      .filter((p) => p.status !== 'cancelled')
      .sort((a, b) => new Date(postDate(a)).getTime() - new Date(postDate(b)).getTime())
      .slice(0, NEXT_POSTS),
  );

  protected when(p: Post): string {
    if (p.status === 'published' && p.published_at) return `publicado ${formatDateTime(p.published_at)}`;
    if (p.scheduled_at) return formatDateTime(p.scheduled_at);
    return 'sem data';
  }
}
