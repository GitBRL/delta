import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsButton, DsGlassCard, DsIcon, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, Automation, AutomationRun } from '../../core/api/api.types';
import { relativeTime } from '../../core/format/relative-time';
import { TenantService } from '../../core/tenant/tenant.service';
import { RUN_STATUS } from './automations';

/** /envios — envios automáticos de relatório da agência, com as aprovações pendentes no topo. */
@Component({
  selector: 'app-automations-page',
  imports: [RouterLink, DsButton, DsGlassCard, DsIcon, DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="m-0 text-footnote font-semibold uppercase tracking-wider text-fg-subtle">{{ tenant.current()?.name }}</p>
        <h1 class="m-0 mt-1 text-large-title font-bold tracking-tight">Envios automáticos</h1>
        <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
          O relatório sai sozinho, no dia e na hora de cada cliente, por e-mail e WhatsApp. Cada envio publica uma
          versão com link próprio e mostra quem recebeu e leu.
        </p>
      </div>
      <a ds-button routerLink="/envios/novo">Novo envio</a>
    </header>

    @if (pendingList().length > 0) {
      <ds-glass-card padding="md" class="mb-6 block pending" animate.enter="ds-enter-fade-up" role="region" aria-label="Aguardando aprovação">
        <p class="m-0 text-headline">
          {{ pendingList().length === 1 ? '1 envio aguardando aprovação' : pendingList().length + ' envios aguardando aprovação' }}
        </p>
        <ul class="pending-list">
          @for (run of pendingList(); track run.id) {
            <li [attr.data-pending]="run.id">
              <span class="min-w-0 flex-1 truncate">
                <strong>{{ run.automation_name ?? 'Envio' }}</strong>
                <small class="text-fg-muted"> · preparado {{ relativeTime(run.created_at) }}</small>
              </span>
              <a ds-button variant="ghost" size="sm" [routerLink]="['/envios', run.automation_id]" [queryParams]="{ aba: 'historico' }">Revisar</a>
              <button ds-button size="sm" [loading]="approving() === run.id" [disabled]="!!approving()" (click)="approve(run)">Aprovar e enviar</button>
            </li>
          }
        </ul>
      </ds-glass-card>
    }

    @if (automations.isLoading() && !automations.hasValue()) {
      <div class="list">
        @for (i of [1, 2]; track i) {
          <div class="row ds-glass"><ds-skeleton width="40%" /><ds-skeleton width="60%" /></div>
        }
      </div>
    } @else if (automations.error()) {
      <ds-glass-card padding="lg" class="block" role="alert">
        <p class="m-0 text-headline">Não foi possível carregar os envios.</p>
        <button ds-button variant="secondary" size="sm" class="mt-3" (click)="automations.reload()">Tentar de novo</button>
      </ds-glass-card>
    } @else if (list().length === 0) {
      <ds-glass-card padding="lg" class="block empty">
        <span class="empty-icon" aria-hidden="true"><svg dsIcon="send" [size]="24"></svg></span>
        <div class="min-w-0 flex-1">
          <h2 class="m-0 text-title-3 font-semibold">Nenhum envio automático ainda</h2>
          <p class="m-0 mt-1 text-subhead text-fg-muted">
            Escolha um relatório, os contatos do cliente e a agenda (ex.: toda segunda às 9h). Dá para revisar cada
            envio antes de sair.
          </p>
        </div>
        <a ds-button routerLink="/envios/novo">Criar envio</a>
      </ds-glass-card>
    } @else {
      <ul class="list" aria-label="Envios">
        @for (a of list(); track a.id) {
          <li>
            <a class="row ds-glass" [routerLink]="['/envios', a.id]" [attr.data-automation]="a.id" [class.paused]="!a.active">
              <span class="main">
                <strong class="truncate">{{ a.name }}</strong>
                <small class="text-fg-muted truncate">{{ a.project?.name ?? '—' }} · {{ a.report?.title ?? 'relatório removido' }}</small>
              </span>
              <span class="schedule">
                <span>{{ a.active ? a.schedule_label : 'Pausado' }}</span>
                @if (a.active && a.next_run_at) {
                  <small class="text-fg-muted">próximo {{ relativeTime(a.next_run_at) }}</small>
                }
              </span>
              <span class="channels">
                @for (c of a.channels; track c) {
                  <span class="chip">{{ c === 'email' ? 'E-mail' : 'WhatsApp' }}</span>
                }
                @if (a.requires_approval) {
                  <span class="chip">Com aprovação</span>
                }
              </span>
              <span class="last" [attr.data-tone]="a.last_run ? runStatus[a.last_run.status].tone : 'muted'">
                {{ a.last_run ? runStatus[a.last_run.status].label : 'Ainda não enviou' }}
              </span>
            </a>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .pending {
      box-shadow: inset 3px 0 0 var(--ds-status-attention);
    }
    .pending-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: var(--ds-space-3) 0 0;
      padding: 0;
      list-style: none;
    }
    .pending-list li {
      display: flex;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr) auto auto;
      align-items: center;
      gap: var(--ds-space-4);
      padding: var(--ds-space-4) var(--ds-space-5);
      border-radius: var(--ds-radius-lg);
      color: inherit;
      text-decoration: none;
    }
    @media (max-width: 860px) {
      .row {
        grid-template-columns: 1fr;
        gap: var(--ds-space-2);
      }
    }
    .row.paused {
      opacity: 0.7;
    }
    .main,
    .schedule {
      display: flex;
      flex-direction: column;
      min-width: 0;
      font: var(--ds-text-subhead);
    }
    .channels {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .chip {
      padding: 1px 8px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-fill);
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .last {
      font: var(--ds-text-footnote);
      font-weight: 600;
    }
    .last[data-tone='ok'] {
      color: var(--ds-status-healthy);
    }
    .last[data-tone='warn'] {
      color: var(--ds-status-attention);
    }
    .last[data-tone='bad'] {
      color: var(--ds-status-critical);
    }
    .last[data-tone='muted'] {
      color: var(--ds-text-tertiary);
    }
    .empty {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-4);
    }
    .empty-icon {
      display: grid;
      place-items: center;
      width: 52px;
      height: 52px;
      border-radius: var(--ds-radius-lg);
      background: var(--ds-accent-soft);
      color: var(--ds-accent);
    }
  `,
})
export class AutomationsPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);

  protected readonly runStatus = RUN_STATUS;
  protected readonly relativeTime = relativeTime;

  protected readonly automations = httpResource<ApiEnvelope<Automation[]>>(() =>
    this.tenant.currentId() ? API.automations : undefined,
  );
  protected readonly pending = httpResource<ApiEnvelope<AutomationRun[]>>(() =>
    this.tenant.currentId() ? { url: API.automationRuns, params: { status: 'awaiting_approval' } } : undefined,
  );

  protected readonly list = computed(() => (this.automations.hasValue() ? this.automations.value().data : []));
  protected readonly pendingList = computed(() => (this.pending.hasValue() ? this.pending.value().data : []));
  readonly approving = signal<string | null>(null);

  async approve(run: AutomationRun): Promise<void> {
    if (this.approving()) return;
    this.approving.set(run.id);
    try {
      await firstValueFrom(this.http.post<ApiEnvelope<AutomationRun>>(API.automationRunApprove(run.id), {}));
      this.pending.update((current) => ({ data: (current?.data ?? []).filter((r) => r.id !== run.id) }));
      this.automations.reload();
      this.toast.success('Envio aprovado', { message: `${run.automation_name ?? 'O relatório'} está saindo agora.` });
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.pending.reload();
        this.toast.info('Nada a fazer', { message: 'Este envio não está mais aguardando aprovação.' });
      } else if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
        this.toast.error('Não foi possível aprovar');
      }
    } finally {
      this.approving.set(null);
    }
  }
}
