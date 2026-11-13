import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsButton, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, AutomationRun, AutomationRunDetail } from '../../core/api/api.types';
import { relativeTime } from '../../core/format/relative-time';
import { pollWhile } from '../../core/polling/poll-while';
import { MESSAGE_STATUS, PROVIDER_LABEL, RUN_STATUS, isRunLive } from './automations';

/** Intervalo de atualização enquanto há mensagens em andamento. */
export const RUN_POLL_MS = 3000;

/** Histórico de envios de uma automação: execuções, mensagens com status de entrega, aprovação. */
@Component({
  selector: 'app-run-history',
  imports: [RouterLink, DsButton, DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (runs.isLoading() && !runs.hasValue()) {
      <ds-skeleton width="80%" />
      <ds-skeleton width="60%" />
    } @else if (runList().length === 0) {
      <p class="m-0 text-subhead text-fg-muted">Nenhum envio ainda. Use "Enviar agora" ou espere o próximo horário.</p>
    } @else {
      <div class="layout">
        <ul class="runs" aria-label="Execuções">
          @for (run of runList(); track run.id) {
            <li>
              <button type="button" class="run" [class.selected]="run.id === selectedId()" [attr.data-run]="run.id" (click)="select(run.id)">
                <span class="tone" [attr.data-tone]="runStatus[run.status].tone">{{ runStatus[run.status].label }}</span>
                <span class="when">{{ run.trigger === 'manual' ? 'Enviado agora' : 'Agendado' }} · {{ relativeTime(run.created_at) }}</span>
                <span class="counts">
                  {{ run.counts.read + run.counts.delivered + run.counts.sent }} enviada(s)
                  @if (run.counts.failed) { · {{ run.counts.failed }} falha(s) }
                  @if (run.counts.skipped) { · {{ run.counts.skipped }} não enviada(s) }
                </span>
              </button>
            </li>
          }
        </ul>

        <section class="detail" aria-live="polite">
          @if (detail.isLoading() && !detail.hasValue()) {
            <ds-skeleton width="70%" />
          } @else if (current(); as run) {
            <div class="detail-head">
              <div>
                <strong>{{ runStatus[run.status].label }}</strong>
                <small class="block text-fg-muted">
                  {{ run.trigger === 'manual' ? 'Enviado manualmente' : 'Envio agendado' }} {{ relativeTime(run.created_at) }}
                  @if (run.approved_by) { · aprovado por {{ run.approved_by }} }
                </small>
              </div>
              @if (run.snapshot_id) {
                <a class="link" [routerLink]="['/relatorios/versoes', run.snapshot_id]">Ver relatório enviado</a>
              }
            </div>

            @if (run.error) {
              <p class="error" role="alert">{{ run.error }}</p>
            }

            @if (run.status === 'awaiting_approval') {
              <div class="approval" role="group" aria-label="Aprovação">
                <p class="m-0 text-subhead">Este envio espera a sua revisão. Confira a versão publicada e aprove para enviar.</p>
                <div class="flex gap-2">
                  <button ds-button size="sm" [loading]="acting() === 'approve'" [disabled]="!!acting()" (click)="act('approve', run)">Aprovar e enviar</button>
                  <button ds-button size="sm" variant="ghost" [loading]="acting() === 'cancel'" [disabled]="!!acting()" (click)="act('cancel', run)">Cancelar envio</button>
                </div>
              </div>
            }

            @if (run.messages.length) {
              <ul class="messages">
                @for (m of run.messages; track m.id) {
                  <li class="message" [attr.data-message]="m.id" [attr.data-status]="m.status">
                    <span class="ticks" [attr.data-tone]="messageStatus[m.status].tone" [attr.aria-label]="messageStatus[m.status].label">{{ messageStatus[m.status].ticks }}</span>
                    <span class="who">
                      <strong>{{ m.contact_name ?? m.recipient }}</strong>
                      <small>{{ m.channel === 'email' ? 'E-mail' : 'WhatsApp' }} · {{ m.recipient }}{{ m.provider ? ' · ' + (providerLabel[m.provider] ?? m.provider) : '' }}</small>
                      @if (m.error) {
                        <small class="reason">{{ m.error }}</small>
                      }
                    </span>
                    <span class="state">{{ messageStatus[m.status].label }}</span>
                  </li>
                }
              </ul>
            }
          }
        </section>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .layout {
      display: grid;
      gap: var(--ds-space-4);
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    }
    @media (max-width: 860px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
    .runs,
    .messages {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .run {
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: 100%;
      padding: var(--ds-space-3);
      border: 0;
      border-radius: var(--ds-radius-md);
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .run:hover,
    .run.selected {
      background: var(--ds-fill);
    }
    .tone {
      font: var(--ds-text-subhead);
      font-weight: 600;
    }
    .tone[data-tone='ok'] {
      color: var(--ds-status-healthy);
    }
    .tone[data-tone='warn'] {
      color: var(--ds-status-attention);
    }
    .tone[data-tone='bad'] {
      color: var(--ds-status-critical);
    }
    .tone[data-tone='info'] {
      color: var(--ds-accent);
    }
    .tone[data-tone='muted'] {
      color: var(--ds-text-tertiary);
    }
    .when,
    .counts {
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
    }
    .detail {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .detail-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--ds-space-3);
    }
    .link {
      color: var(--ds-accent);
      font: var(--ds-text-footnote);
      font-weight: 600;
      text-decoration: none;
    }
    .error {
      margin: 0;
      color: var(--ds-status-critical);
      font: var(--ds-text-footnote);
    }
    .approval {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      padding: var(--ds-space-4);
      border-radius: var(--ds-radius-md);
      background: color-mix(in srgb, var(--ds-status-attention) 14%, transparent);
    }
    .message {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) auto;
      align-items: start;
      gap: var(--ds-space-2);
      padding: var(--ds-space-2) var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
    }
    .ticks {
      font-weight: 700;
      letter-spacing: -2px;
      color: var(--ds-text-tertiary);
    }
    .ticks[data-tone='read'] {
      color: #34b7f1;
    }
    .ticks[data-tone='bad'] {
      color: var(--ds-status-critical);
      letter-spacing: 0;
    }
    .who {
      display: flex;
      flex-direction: column;
      min-width: 0;
      font: var(--ds-text-subhead);
    }
    .who small {
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
      overflow-wrap: anywhere;
    }
    .who .reason {
      color: var(--ds-status-attention);
    }
    .state {
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
    }
  `,
})
export class RunHistory {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);

  readonly automationId = input.required<string>();

  protected readonly runStatus = RUN_STATUS;
  protected readonly messageStatus = MESSAGE_STATUS;
  protected readonly providerLabel = PROVIDER_LABEL;
  protected readonly relativeTime = relativeTime;

  protected readonly runs = httpResource<ApiEnvelope<AutomationRun[]>>(() => ({
    url: API.automationRuns,
    params: { automation_id: this.automationId() },
  }));
  protected readonly runList = computed(() => (this.runs.hasValue() ? this.runs.value().data : []));

  private readonly chosen = signal<string | null>(null);
  /** Execução aberta: a escolhida ou a mais recente. */
  readonly selectedId = computed(() => this.chosen() ?? this.runList()[0]?.id ?? null);

  protected readonly detail = httpResource<ApiEnvelope<AutomationRunDetail>>(() => {
    const id = this.selectedId();
    return id ? API.automationRun(id) : undefined;
  });
  protected readonly current = computed(() => (this.detail.hasValue() ? this.detail.value().data : null));
  readonly acting = signal<'approve' | 'cancel' | null>(null);

  constructor() {
    pollWhile(
      () => {
        const run = this.current();
        return !!run && isRunLive(run);
      },
      () => {
        if (!this.detail.isLoading()) this.detail.reload();
        if (!this.runs.isLoading()) this.runs.reload();
      },
      RUN_POLL_MS,
    );
  }

  select(id: string): void {
    this.chosen.set(id);
  }

  /** Recarrega a lista e abre a execução informada (ex.: depois de "Enviar agora"). */
  show(run: AutomationRun): void {
    this.runs.update((current) => ({ data: [run, ...(current?.data ?? []).filter((r) => r.id !== run.id)] }));
    this.chosen.set(run.id);
    this.detail.reload();
  }

  protected async act(action: 'approve' | 'cancel', run: AutomationRun): Promise<void> {
    if (this.acting()) return;
    this.acting.set(action);
    try {
      const url = action === 'approve' ? API.automationRunApprove(run.id) : API.automationRunCancel(run.id);
      const res = await firstValueFrom(this.http.post<ApiEnvelope<AutomationRun>>(url, {}));
      this.runs.update((current) => ({ data: (current?.data ?? []).map((r) => (r.id === run.id ? res.data : r)) }));
      this.detail.reload();
      this.toast.success(action === 'approve' ? 'Envio aprovado' : 'Envio cancelado', {
        message: action === 'approve' ? 'As mensagens estão saindo agora.' : 'Nada foi enviado.',
      });
    } catch (error) {
      const message =
        error instanceof HttpErrorResponse && error.status === 409
          ? ((error.error as { message?: string } | null)?.message ?? 'Este envio não está mais aguardando aprovação.')
          : null;
      if (message) {
        this.toast.info('Nada a fazer', { message });
        this.detail.reload();
      } else if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
        this.toast.error('Não foi possível concluir');
      }
    } finally {
      this.acting.set(null);
    }
  }
}
