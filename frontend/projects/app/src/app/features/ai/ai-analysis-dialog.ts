import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideSparkles, LucideX } from '@lucide/angular';
import { DsButton, DsSkeleton } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, AiAnalysisBody, AiReply, ApiEnvelope, TENANT_HEADER } from '../../core/api/api.types';
import { TenantService } from '../../core/tenant/tenant.service';
import { AiReplyView } from './ai-reply';
import { AiStatusStore, aiErrorMessage, aiReady, aiUnavailableText } from './ai';

/**
 * "Escrever análise com IA" no editor de relatório: pede o rascunho com o estado atual do editor
 * (período, comparação e blocos, sem precisar salvar) e deixa a pessoa inserir ou descartar.
 */
@Component({
  selector: 'app-ai-analysis-dialog',
  imports: [RouterLink, DsButton, DsSkeleton, AiReplyView, LucideSparkles, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'dismissed.emit()' },
  template: `
    <div class="backdrop" (click)="dismissed.emit()" aria-hidden="true"></div>
    <section class="panel ds-glass" role="dialog" aria-modal="true" aria-labelledby="ai-analysis-title" animate.enter="ds-enter-fade-up">
      <header class="head">
        <div class="flex items-center gap-2">
          <span class="badge" aria-hidden="true"><svg lucideSparkles [size]="16"></svg></span>
          <div>
            <h2 id="ai-analysis-title" class="m-0 text-title-3 font-semibold">Análise com IA</h2>
            <p class="m-0 text-footnote text-fg-muted">Rascunho com os números do período escolhido no editor.</p>
          </div>
        </div>
        <button type="button" class="close" (click)="dismissed.emit()" aria-label="Fechar">
          <svg lucideX [size]="18"></svg>
        </button>
      </header>

      @if (store.loading()) {
        <div class="loading" aria-busy="true"><ds-skeleton width="60%" /><ds-skeleton width="90%" /></div>
      } @else if (store.failed()) {
        <div class="state" role="alert">
          <p class="m-0">Não foi possível conferir o copiloto de IA.</p>
          <button ds-button variant="secondary" size="sm" (click)="store.reload()">Tentar de novo</button>
        </div>
      } @else if (store.status(); as status) {
        @if (!ready()) {
          <div class="state" data-testid="ai-empty">
            <p class="m-0 text-headline">{{ unavailable(status) }}</p>
            @if (canConfigure()) {
              <a class="link" routerLink="/configuracoes/ia" (click)="dismissed.emit()">Configurar em Configurações › IA</a>
            } @else {
              <p class="m-0 text-footnote text-fg-muted">Peça a um dono ou administrador da agência para ativar.</p>
            }
          </div>
        } @else if (loading()) {
          <div class="loading" aria-busy="true" role="status">
            <p class="m-0 text-footnote text-fg-muted">Escrevendo a análise… pode levar alguns segundos.</p>
            <ds-skeleton width="95%" />
            <ds-skeleton width="88%" />
            <ds-skeleton width="70%" />
          </div>
        } @else if (error()) {
          <div class="state" role="alert">
            <p class="m-0 error">{{ error() }}</p>
            <button ds-button variant="secondary" size="sm" (click)="generate()">Tentar de novo</button>
          </div>
        } @else if (reply(); as r) {
          <app-ai-reply [reply]="r" />
          <div class="actions">
            <button ds-button (click)="inserted.emit(r.text)">Inserir no relatório</button>
            <button ds-button variant="secondary" (click)="generate()">Gerar de novo</button>
            <button ds-button variant="ghost" (click)="dismissed.emit()">Descartar</button>
          </div>
        }
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
      width: min(640px, 100%);
      max-height: calc(100dvh - 32px);
      overflow: auto;
      padding: var(--ds-space-6);
      border-radius: var(--ds-radius-xl);
    }
    @media (max-width: 560px) {
      .panel {
        padding: var(--ds-space-4);
      }
    }
    .head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--ds-space-3);
    }
    .badge {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 10px;
      background: color-mix(in oklch, var(--ds-accent) 14%, transparent);
      color: var(--ds-accent);
    }
    .close {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 50%;
      background: var(--ds-fill);
      color: var(--ds-text-secondary);
      cursor: pointer;
    }
    .loading,
    .state {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--ds-space-2);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-2);
    }
    .link {
      color: var(--ds-accent);
      font: var(--ds-text-subhead);
      font-weight: 600;
      text-decoration: none;
    }
    .error {
      color: var(--ds-status-critical);
    }
  `,
})
export class AiAnalysisDialog {
  readonly reportId = input.required<string>();
  /** Estado atual do editor (vale mesmo sem salvar). */
  readonly body = input.required<AiAnalysisBody>();
  /** Dono/admin: mostra o atalho para configurar o copiloto. */
  readonly canConfigure = input(false);

  readonly inserted = output<string>();
  readonly dismissed = output<void>();

  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);
  protected readonly store = inject(AiStatusStore);

  readonly reply = signal<AiReply | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  protected readonly ready = () => aiReady(this.store.status());
  protected readonly unavailable = aiUnavailableText;

  constructor() {
    // Abriu com o copiloto pronto: já pede o rascunho (uma vez).
    let started = false;
    effect(() => {
      if (started || !aiReady(this.store.status())) return;
      started = true;
      untracked(() => void this.generate());
    });
  }

  async generate(): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiEnvelope<AiReply>>(API.reportAiAnalysis(this.reportId()), this.body(), {
          headers: { [TENANT_HEADER]: tenantId },
        }),
      );
      this.reply.set(res.data);
    } catch (error) {
      this.reply.set(null);
      this.error.set(aiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
}
