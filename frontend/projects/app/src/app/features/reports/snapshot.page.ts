import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideDownload, LucideShare2 } from '@lucide/angular';
import { DsButton, DsSkeleton, DsStatusBadge } from 'design-system';
import { API, ApiEnvelope, Snapshot, TENANT_HEADER } from '../../core/api/api.types';
import { relativeTime } from '../../core/format/relative-time';
import { pollWhile } from '../../core/polling/poll-while';
import { ReportPdfService } from '../../core/reports/report-pdf';
import { TenantService } from '../../core/tenant/tenant.service';
import { PDF_POLL_MS } from './report-versions';
import { ReportView } from './report-view';
import { ShareDialog } from './share-dialog';

function httpStatus(error: unknown): number | null {
  if (error instanceof HttpErrorResponse) return error.status;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause instanceof HttpErrorResponse ? cause.status : null;
}

/** Versão publicada de um relatório (equipe e cliente). Rota: /relatorios/versoes/:id */
@Component({
  selector: 'app-snapshot-page',
  imports: [RouterLink, DsButton, DsSkeleton, DsStatusBadge, ReportView, ShareDialog, LucideArrowLeft, LucideDownload, LucideShare2],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (snapshot.hasValue()) {
      @let s = snapshot.value().data;
      <div class="bar no-print">
        @if (canManage()) {
          <a class="back" [routerLink]="['/relatorios', s.report_id]">
            <svg lucideArrowLeft [size]="16"></svg>
            Editar relatório
          </a>
        } @else {
          <a class="back" [routerLink]="['/projetos', s.project_id]">
            <svg lucideArrowLeft [size]="16"></svg>
            Projeto
          </a>
        }
        <span class="published">Versão publicada {{ relativeTime(s.created_at) }}</span>
        <div class="actions">
          @switch (s.pdf_status) {
            @case ('ready') {
              <button ds-button variant="secondary" size="sm" [loading]="downloading()" (click)="download(s)">
                <svg lucideDownload [size]="14"></svg>
                Baixar PDF
              </button>
            }
            @case ('pending') {
              <ds-status-badge status="opportunity" label="Gerando PDF…" [pulse]="true" />
            }
            @case ('failed') {
              <span class="pdf-error">PDF indisponível</span>
            }
          }
          <button ds-button variant="ghost" size="sm" (click)="print()">
            Imprimir
          </button>
          @if (canManage()) {
            <button ds-button size="sm" (click)="sharing.set(true)">
              <svg lucideShare2 [size]="14"></svg>
              Compartilhar
            </button>
          }
        </div>
      </div>
      <app-report-view [data]="s.data" />

      @if (sharing()) {
        <app-share-dialog [snapshotId]="s.id" [title]="s.title" (dismissed)="sharing.set(false)" />
      }
    } @else if (notFound()) {
      <div class="state ds-glass" role="alert">
        <p class="m-0 text-headline">Versão não encontrada</p>
        <p class="m-0 text-footnote text-fg-muted">Ela pode ter sido excluída ou você não tem acesso a este projeto.</p>
      </div>
    } @else if (snapshot.error()) {
      <div class="state ds-glass" role="alert">
        <p class="m-0 text-headline">Não foi possível carregar o relatório.</p>
        <button ds-button variant="secondary" size="sm" (click)="snapshot.reload()">Tentar de novo</button>
      </div>
    } @else {
      <div class="loading" aria-busy="true">
        <ds-skeleton height="160px" radius="var(--ds-radius-xl)" />
        <ds-skeleton width="40%" height="20px" />
        <ds-skeleton height="120px" radius="var(--ds-radius-lg)" />
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      max-width: 1040px;
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-3);
      margin-bottom: var(--ds-space-5);
    }
    .back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--ds-text-secondary);
      font: var(--ds-text-footnote);
      font-weight: 600;
      text-decoration: none;
    }
    .back:hover {
      color: var(--ds-accent);
    }
    .published {
      font: var(--ds-text-footnote);
      color: var(--ds-text-tertiary);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
      margin-left: auto;
    }
    .pdf-error {
      font: var(--ds-text-footnote);
      color: var(--ds-status-critical);
    }
    .state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--ds-space-2);
      padding: var(--ds-space-8) var(--ds-space-6);
      border-radius: var(--ds-radius-xl);
      text-align: center;
    }
    .loading {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    @media print {
      .no-print {
        display: none;
      }
    }
  `,
})
export class SnapshotPage {
  readonly id = input.required<string>();

  private readonly pdf = inject(ReportPdfService);
  protected readonly tenant = inject(TenantService);
  protected readonly relativeTime = relativeTime;

  protected readonly canManage = computed(() => this.tenant.current()?.role !== 'client');
  protected readonly snapshot = httpResource<ApiEnvelope<Snapshot>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url: API.snapshot(this.id()), headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });
  protected readonly notFound = computed(() => httpStatus(this.snapshot.error()) === 404);
  private readonly generating = computed(() => this.snapshot.hasValue() && this.snapshot.value().data.pdf_status === 'pending');

  protected readonly downloading = signal(false);
  readonly sharing = signal(false);

  constructor() {
    pollWhile(
      () => this.generating(),
      () => {
        if (!this.snapshot.isLoading()) this.snapshot.reload();
      },
      PDF_POLL_MS,
    );
  }

  protected async download(s: Snapshot): Promise<void> {
    this.downloading.set(true);
    try {
      await this.pdf.snapshot(s.id, `${s.title} ${s.period.start} a ${s.period.end}`, this.tenant.currentId());
    } finally {
      this.downloading.set(false);
    }
  }

  protected print(): void {
    if (typeof window.print === 'function') window.print();
  }
}
