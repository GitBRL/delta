import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Placeholder de carregamento com shimmer (o brilho anda por transform). */
@Component({
  selector: 'ds-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ds-skeleton',
    'aria-hidden': 'true',
    '[style.width]': 'width()',
    '[style.height]': 'height()',
    '[style.border-radius]': 'radius()',
  },
  template: '',
  styles: `
    :host {
      position: relative;
      display: block;
      overflow: hidden;
      background: var(--ds-fill);
    }

    :host::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        100deg,
        transparent 20%,
        light-dark(rgb(255 255 255 / 0.65), rgb(255 255 255 / 0.08)) 50%,
        transparent 80%
      );
      transform: translateX(-100%);
      animation: shimmer 1.4s var(--ds-ease-out) infinite;
    }

    @keyframes shimmer {
      to {
        transform: translateX(100%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      :host::after {
        animation: none;
        opacity: 0;
      }
    }
  `,
})
export class DsSkeleton {
  readonly width = input('100%');
  readonly height = input('16px');
  readonly radius = input('var(--ds-radius-sm)');
}
