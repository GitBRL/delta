import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideFileText, LucidePlus } from '@lucide/angular';
import { DsButton, DsSkeleton } from 'design-system';
import { API, ApiEnvelope, SnapshotSummary, TENANT_HEADER } from '../../core/api/api.types';
import { relativeTime } from '../../core/format/relative-time';
import { formatRange } from '../../core/metrics/period';
import { TenantService } from '../../core/tenant/tenant.service';

/** Relatórios publicados do projeto (o cliente também vê: são os dele). */
@Component({
  selector: 'app-project-reports',
  imports: [RouterLink, DsButton, DsSkeleton, LucideFileText, LucidePlus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h2 class="m-0 text-headline">Relatórios publicados</h2>
      @if (canManage()) {
        <a class="new" [routerLink]="['/relatorios']" [queryParams]="{ novo: projectId() }">
          <svg lucidePlus [size]="14"></svg>
          Novo
        </a>
      }
    </div>
    @if (snapshots.isLoading() && !snapshots.hasValue()) {
      <ds-skeleton width="80%" />
      <ds-skeleton width="60%" />
    } @else if (snapshots.error()) {
      <p class="m-0 text-footnote text-fg-muted" role="alert">
        Não foi possível carregar os relatórios.
        <button ds-button variant="ghost" size="sm" (click)="snapshots.reload()">Tentar de novo</button>
      </p>
    } @else if (list().length === 0) {
      <p class="m-0 text-footnote text-fg-muted">
        {{ canManage() ? 'Nenhuma versão publicada ainda. Crie um relatório a partir de um modelo.' : 'A agência ainda não publicou relatórios deste projeto.' }}
      </p>
    } @else {
      <ul class="list">
        @for (s of list(); track s.id) {
          <li>
            <a class="item" [routerLink]="['/relatorios/versoes', s.id]" [attr.data-snapshot]="s.id">
              <span class="icon" aria-hidden="true"><svg lucideFileText [size]="16"></svg></span>
              <span class="text">
                <strong>{{ s.title }}</strong>
                <small>{{ formatRange(s.period) }} · publicado {{ relativeTime(s.created_at) }}</small>
              </span>
            </a>
          </li>
        }
      </ul>
    }
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
    .new {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--ds-accent);
      font: var(--ds-text-footnote);
      font-weight: 600;
      text-decoration: none;
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
      transition: background-color var(--ds-duration-fast) var(--ds-ease-out);
    }
    .item:hover {
      background: var(--ds-fill);
    }
    .icon {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      flex: none;
      border-radius: 10px;
      background: var(--ds-accent-soft, var(--ds-fill));
      color: var(--ds-accent);
    }
    .text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .text strong {
      font: var(--ds-text-subhead);
      font-weight: 600;
    }
    .text small {
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
  `,
})
export class ProjectReports {
  readonly projectId = input.required<string>();

  private readonly tenant = inject(TenantService);
  protected readonly formatRange = formatRange;
  protected readonly relativeTime = relativeTime;

  protected readonly canManage = computed(() => this.tenant.current()?.role !== 'client');
  protected readonly snapshots = httpResource<ApiEnvelope<SnapshotSummary[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url: API.projectSnapshots(this.projectId()), headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });
  protected readonly list = computed(() => (this.snapshots.hasValue() ? this.snapshots.value().data.slice(0, 8) : []));
}
