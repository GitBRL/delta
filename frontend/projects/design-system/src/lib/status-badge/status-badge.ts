import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { StatusLevel, statusMeta } from './status';

/**
 * Selo do semáforo de atenção.
 * Uso: <ds-status-badge status="attention" /> ou com texto próprio: <ds-status-badge status="critical" label="CPA acima da meta" />
 */
@Component({
  selector: 'ds-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ds-status-badge',
    role: 'status',
    '[attr.data-status]': 'status()',
    '[class.pulses]': 'pulse() ?? meta().pulses',
    '[style.--status-color]': '"var(" + meta().colorVar + ")"',
    '[attr.aria-label]': '"Status: " + (label() ?? meta().label)',
  },
  template: `
    <span class="dot" aria-hidden="true"></span>
    @if (!compact()) {
      <span class="text">{{ label() ?? meta().label }}</span>
    }
  `,
  styleUrl: './status-badge.css',
})
export class DsStatusBadge {
  readonly status = input.required<StatusLevel>();
  /** Texto alternativo ao rótulo padrão do estado. */
  readonly label = input<string>();
  /** Mostra só o ponto colorido (o aria-label continua presente). */
  readonly compact = input(false);
  /** Força (ou desliga) o pulso; por padrão pulsam só os estados que pedem ação. */
  readonly pulse = input<boolean | null>(null);

  protected readonly meta = computed(() => statusMeta(this.status()));
}
