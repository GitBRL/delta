import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Fundo ambiente: manchas de cor desfocadas que derivam devagar (só transform).
 * O desfoque é estático; o navegador compõe as camadas sem repintar.
 */
@Component({
  selector: 'app-ambient-background',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <span class="blob b1"></span>
    <span class="blob b2"></span>
    <span class="blob b3"></span>
    <span class="grain"></span>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 0;
      overflow: hidden;
      pointer-events: none;
      background: var(--ds-bg);
    }

    .blob {
      position: absolute;
      width: 46vmax;
      height: 46vmax;
      border-radius: 50%;
      filter: blur(70px);
      opacity: 0.55;
      will-change: transform;
    }

    .b1 {
      top: -14vmax;
      left: -10vmax;
      background: var(--ds-ring-acquisition);
      animation: drift-1 22s ease-in-out infinite alternate;
    }

    .b2 {
      right: -16vmax;
      top: 10vmax;
      background: var(--ds-ring-engagement);
      opacity: 0.4;
      animation: drift-2 26s ease-in-out infinite alternate;
    }

    .b3 {
      bottom: -20vmax;
      left: 20vmax;
      background: var(--ds-accent);
      opacity: 0.35;
      animation: drift-3 30s ease-in-out infinite alternate;
    }

    .grain {
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at center, transparent 40%, var(--ds-bg) 100%);
    }

    @keyframes drift-1 {
      to {
        transform: translate(12vmax, 8vmax) scale(1.1);
      }
    }

    @keyframes drift-2 {
      to {
        transform: translate(-10vmax, 10vmax) scale(0.9);
      }
    }

    @keyframes drift-3 {
      to {
        transform: translate(8vmax, -10vmax) scale(1.15);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .blob {
        animation: none;
      }
    }
  `,
})
export class AmbientBackground {}
