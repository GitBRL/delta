import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DsIcon } from '../icon/icon';
import { DsThemeService } from './theme.service';

const LABELS = { system: 'Tema do sistema', light: 'Tema claro', dark: 'Tema escuro' } as const;

/** Botão que alterna o tema (sistema → claro → escuro). */
@Component({
  selector: 'ds-theme-toggle',
  imports: [DsIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="toggle" (click)="theme.cycle()" [attr.aria-label]="label() + ' (clique para trocar)'" [title]="label()">
      @switch (theme.mode()) {
        @case ('light') {
          <svg dsIcon="sun" [size]="18" animate.enter="ds-enter-scale"></svg>
        }
        @case ('dark') {
          <svg dsIcon="moon" [size]="18" animate.enter="ds-enter-scale"></svg>
        }
        @default {
          <svg dsIcon="monitor" [size]="18" animate.enter="ds-enter-scale"></svg>
        }
      }
    </button>
  `,
  styles: `
    .toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: var(--ds-radius-md);
      background: transparent;
      color: var(--ds-text-secondary);
      cursor: pointer;
      transition: transform var(--ds-duration-base) var(--ds-ease-spring);
    }

    .toggle:hover {
      background: var(--ds-fill);
      color: var(--ds-text);
    }

    .toggle:active {
      transform: scale(0.92);
    }
  `,
})
export class DsThemeToggle {
  protected readonly theme = inject(DsThemeService);
  protected readonly label = computed(() => LABELS[this.theme.mode()]);
}
