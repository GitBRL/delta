import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, input, output, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsButton } from 'design-system';
import { PlanLimitNotice } from './plan-limit';

/** Diálogo "Limite do plano" (402). "Ver plano" só para quem pode ver a página do plano. */
@Component({
  selector: 'app-plan-limit-dialog',
  imports: [RouterLink, DsButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'dismissed.emit()' },
  template: `
    <div class="backdrop" (click)="dismissed.emit()" aria-hidden="true"></div>
    <section
      class="panel ds-glass"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="plan-limit-title"
      aria-describedby="plan-limit-message"
      animate.enter="ds-enter-fade-up"
    >
      <h2 id="plan-limit-title" class="m-0 text-title-3 font-semibold">Limite do plano</h2>
      <p id="plan-limit-message" class="m-0 text-body">{{ notice().message }}</p>
      @if (notice().allowed !== null && notice().used !== null) {
        <p class="m-0 text-footnote text-fg-muted" data-testid="plan-limit-usage">Em uso: {{ notice().used }} de {{ notice().allowed }}.</p>
      }
      @if (!canSeePlan()) {
        <p class="m-0 text-footnote text-fg-muted">Peça a um dono ou administrador da agência para mudar de plano.</p>
      }
      <div class="actions">
        <button #close ds-button type="button" variant="ghost" (click)="dismissed.emit()">Fechar</button>
        @if (canSeePlan()) {
          <a ds-button routerLink="/configuracoes/plano" (click)="dismissed.emit()">Ver plano</a>
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: var(--ds-z-overlay, 60);
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
      gap: var(--ds-space-3);
      width: min(440px, 100%);
      padding: var(--ds-space-6);
      border-radius: var(--ds-radius-xl);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--ds-space-2);
      margin-top: var(--ds-space-2);
    }
  `,
})
export class PlanLimitDialog {
  readonly notice = input.required<PlanLimitNotice>();
  readonly canSeePlan = input(false);
  readonly dismissed = output<void>();

  private readonly close = viewChild<ElementRef<HTMLElement>>('close');

  constructor() {
    // Foco no diálogo para leitores de tela e teclado.
    afterNextRender(() => this.close()?.nativeElement.focus());
  }
}
