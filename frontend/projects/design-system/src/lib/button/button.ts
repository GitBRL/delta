import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Botão do DS aplicado sobre o elemento nativo (mantém semântica e acessibilidade).
 * Uso: <button ds-button variant="primary" [loading]="saving()" [disabled]="saving()">Salvar</button>
 * `loading` só cuida do visual e de aria-busy; desabilitar continua sendo decisão de quem usa.
 */
@Component({
  selector: 'button[ds-button], a[ds-button]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ds-button',
    '[attr.data-variant]': 'variant()',
    '[attr.data-size]': 'size()',
    '[class.is-loading]': 'loading()',
    '[class.is-block]': 'block()',
    '[attr.aria-busy]': 'loading() || null',
  },
  template: `
    @if (loading()) {
      <span class="spinner" aria-hidden="true"></span>
    }
    <span class="content"><ng-content /></span>
  `,
  styleUrl: './button.css',
})
export class DsButton {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly loading = input(false);
  /** Ocupa toda a largura do contêiner. */
  readonly block = input(false);
}
