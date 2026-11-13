import { HttpClient, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideDownload, LucideRefreshCw, LucideShare2 } from '@lucide/angular';
import { DsButton, DsSkeleton, DsStatusBadge } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, SnapshotSummary, TENANT_HEADER } from '../../core/api/api.types';
import { relativeTime } from '../../core/format/relative-time';
import { formatRange } from '../../core/metrics/period';
import { pollWhile } from '../../core/polling/poll-while';
import { ReportPdfService } from '../../core/reports/report-pdf';
import { TenantService } from '../../core/tenant/tenant.service';
import { ShareDialog } from './share-dialog';

/** Intervalo de atualização enquanto algum PDF está sendo gerado. */
export const PDF_POLL_MS = 2000;

/**
 * Versões publicadas de um relatório: status do PDF (atualiza sozinho enquanto gera),
 * ver, baixar, tentar de novo e compartilhar por link.
 */
@Component({
  selector: 'app-report-versions',
  imports: [RouterLink, DsButton, DsSkeleton, DsStatusBadge, ShareDialog, LucideDownload, LucideRefreshCw, LucideShare2],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (snapshots.isLoading() && !snapshots.hasValue()) {
      <div class="list" aria-busy="true">
        <ds-skeleton width="60%" height="16px" />
        <ds-skeleton width="40%" />
      </div>
    } @else if (snapshots.error()) {
      <div class="empty" role="alert">
        <p class="m-0 text-headline">Não foi possível carregar as versões.</p>
        <button ds-button variant="secondary" size="sm" (click)="snapshots.reload()">Tentar de novo</button>
      </div>
    } @else if (list().length === 0) {
      <div class="empty">
        <p class="m-0 text-headline">Nenhuma versão publicada</p>
        <p class="m-0 text-footnote text-fg-muted">
          Publicar congela os números do período: é a versão que vira PDF e link para o cliente.
        </p>
      </div>
    } @else {
      <ul class="list">
        @for (s of list(); track s.id; let first = $first) {
          <li class="version ds-glass" [attr.data-snapshot]="s.id" animate.enter="ds-enter-fade-up">
            <div class="info">
              <p class="m-0 text-subhead font-semibold">
                {{ s.title }}
                @if (first) {
                  <span class="latest">mais recente</span>
                }
              </p>
              <p class="m-0 text-footnote text-fg-muted">
                {{ formatRange(s.period) }} · publicado {{ relativeTime(s.created_at) }}
                @if (s.active_links > 0) {
                  · {{ s.active_links }} {{ s.active_links === 1 ? 'link ativo' : 'links ativos' }}
                }
              </p>
              @switch (s.pdf_status) {
                @case ('pending') {
                  <ds-status-badge class="pdf" status="opportunity" label="Gerando PDF…" [pulse]="true" />
                }
                @case ('failed') {
                  <p class="pdf-error" role="alert">{{ s.pdf_error ?? 'Não foi possível gerar o PDF.' }}</p>
                }
              }
            </div>
            <div class="actions">
              <a ds-button variant="ghost" size="sm" [routerLink]="['/relatorios/versoes', s.id]">
                Ver
              </a>
              @if (s.pdf_status === 'ready') {
                <button ds-button variant="secondary" size="sm" [loading]="downloading() === s.id" (click)="download(s)">
                  <svg lucideDownload [size]="14"></svg>
                  Baixar PDF
                </button>
              } @else if (s.pdf_status === 'failed' && canManage()) {
                <button ds-button variant="secondary" size="sm" [loading]="retrying() === s.id" (click)="retry(s)">
                  <svg lucideRefreshCw [size]="14"></svg>
                  Tentar de novo
                </button>
              }
              @if (canManage()) {
                <button ds-button size="sm" (click)="sharing.set(s)">
                  <svg lucideShare2 [size]="14"></svg>
                  Compartilhar
                </button>
              }
            </div>
          </li>
        }
      </ul>
    }

    @if (sharing(); as s) {
      <app-share-dialog [snapshotId]="s.id" [title]="s.title + ' · ' + formatRange(s.period)" (dismissed)="sharing.set(null)" (changed)="snapshots.reload()" />
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .version {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-3);
      padding: var(--ds-space-4);
      border-radius: var(--ds-radius-lg);
    }
    .info {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .latest {
      margin-left: 6px;
      padding: 1px 8px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-accent-soft, var(--ds-fill));
      color: var(--ds-accent);
      font: var(--ds-text-caption);
      font-weight: 700;
    }
    .pdf {
      align-self: flex-start;
    }
    .pdf-error {
      margin: 0;
      font: var(--ds-text-footnote);
      color: var(--ds-status-critical);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-2);
    }
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--ds-space-2);
      padding: var(--ds-space-8) var(--ds-space-6);
      border-radius: var(--ds-radius-xl);
      background: var(--ds-fill);
      text-align: center;
    }
  `,
})
export class ReportVersions {
  readonly reportId = input.required<string>();
  /** Equipe: tentar de novo e compartilhar. */
  readonly canManage = input(true);

  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);
  private readonly pdf = inject(ReportPdfService);

  protected readonly formatRange = formatRange;
  protected readonly relativeTime = relativeTime;

  protected readonly snapshots = httpResource<ApiEnvelope<SnapshotSummary[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url: API.reportSnapshots(this.reportId()), headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });
  readonly list = computed(() => (this.snapshots.hasValue() ? this.snapshots.value().data : []));
  readonly generating = computed(() => this.list().some((s) => s.pdf_status === 'pending'));

  protected readonly downloading = signal<string | null>(null);
  protected readonly retrying = signal<string | null>(null);
  readonly sharing = signal<SnapshotSummary | null>(null);

  constructor() {
    pollWhile(
      () => this.generating(),
      () => {
        if (!this.snapshots.isLoading()) this.snapshots.reload();
      },
      PDF_POLL_MS,
    );
  }

  /** Recarrega a lista (ex.: logo depois de publicar). */
  reload(): void {
    this.snapshots.reload();
  }

  /** Abre o compartilhamento de uma versão (ex.: a recém-publicada). */
  share(snapshot: SnapshotSummary): void {
    this.sharing.set(snapshot);
  }

  protected async download(s: SnapshotSummary): Promise<void> {
    this.downloading.set(s.id);
    try {
      await this.pdf.snapshot(s.id, `${s.title} ${s.period.start} a ${s.period.end}`, this.tenant.currentId());
    } finally {
      this.downloading.set(null);
    }
  }

  protected async retry(s: SnapshotSummary): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId) return;
    this.retrying.set(s.id);
    try {
      await firstValueFrom(this.http.post(API.snapshotPdf(s.id), {}, { headers: { [TENANT_HEADER]: tenantId } }));
      this.snapshots.update((current) => ({
        data: (current?.data ?? []).map((x) => (x.id === s.id ? { ...x, pdf_status: 'pending' as const, pdf_error: null } : x)),
      }));
    } catch {
      /* 403/5xx: toast no interceptor */
    } finally {
      this.retrying.set(null);
    }
  }
}
