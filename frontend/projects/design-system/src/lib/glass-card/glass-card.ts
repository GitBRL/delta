import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
} from '@angular/core';
import { prefersReducedMotion } from '../motion/motion';

/**
 * Cartão de vidro. Com `interactive`, ganha brilho que segue o cursor e inclinação 3D leve.
 * Os listeners de ponteiro ficam fora do template de propósito: atualizam só variáveis CSS
 * (consumidas por transform/opacity) e não disparam detecção de mudanças.
 */
@Component({
  selector: 'ds-glass-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ds-glass-card',
    '[class.is-interactive]': 'interactive()',
    '[attr.data-padding]': 'padding()',
  },
  template: `
    <span class="glow" aria-hidden="true"></span>
    <div class="body"><ng-content /></div>
  `,
  styleUrl: './glass-card.css',
})
export class DsGlassCard {
  readonly interactive = input(false);
  readonly tilt = input(true);
  readonly padding = input<'none' | 'sm' | 'md' | 'lg'>('md');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const el = this.host.nativeElement;
      let frame = 0;

      const onMove = (event: PointerEvent) => {
        if (!this.interactive() || event.pointerType === 'touch') {
          return;
        }
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const rect = el.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          el.style.setProperty('--glow-x', `${x}px`);
          el.style.setProperty('--glow-y', `${y}px`);
          if (this.tilt() && !prefersReducedMotion()) {
            const rx = (y / rect.height - 0.5) * -4;
            const ry = (x / rect.width - 0.5) * 4;
            el.style.setProperty('--tilt-x', `${rx.toFixed(2)}deg`);
            el.style.setProperty('--tilt-y', `${ry.toFixed(2)}deg`);
          }
        });
      };

      const onLeave = () => {
        cancelAnimationFrame(frame);
        el.style.setProperty('--tilt-x', '0deg');
        el.style.setProperty('--tilt-y', '0deg');
      };

      el.addEventListener('pointermove', onMove, { passive: true });
      el.addEventListener('pointerleave', onLeave, { passive: true });
      destroyRef.onDestroy(() => {
        cancelAnimationFrame(frame);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerleave', onLeave);
      });
    });
  }
}
