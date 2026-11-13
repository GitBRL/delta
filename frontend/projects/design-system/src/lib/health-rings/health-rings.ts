import { ChangeDetectionStrategy, Component, afterNextRender, computed, input, signal } from '@angular/core';
import { clampPercent, leftHalfPath, rightHalfPath, ringAngles } from './ring-geometry';

let nextId = 0;

interface RingView {
  key: 'acquisition' | 'engagement' | 'conversion';
  label: string;
  value: number;
  r: number;
  color: string;
  left: string;
  right: string;
  a: number;
  b: number;
  durA: number;
  durB: number;
  delay: number;
}

const STROKE = 9;
const RADII = [42, 31, 20] as const;
/** Tempo para varrer 180°. */
const HALF_SWEEP_MS = 520;

/**
 * Três anéis de saúde da conta (Aquisição, Engajamento, Conversão), 0–100.
 */
@Component({
  selector: 'ds-health-rings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ds-health-rings',
    '[class.is-drawn]': 'drawn()',
    '[style.--size]': 'size() + "px"',
  },
  template: `
    <svg viewBox="0 0 100 100" role="img" [attr.aria-label]="ariaLabel()">
      <defs>
        <clipPath [attr.id]="uid + '-r'"><rect x="50" y="0" width="50" height="100" /></clipPath>
        <clipPath [attr.id]="uid + '-l'"><rect x="0" y="0" width="50" height="100" /></clipPath>
      </defs>
      @for (ring of rings(); track ring.key) {
        <circle
          class="track"
          cx="50"
          cy="50"
          [attr.r]="ring.r"
          [attr.stroke-width]="stroke"
          [style.stroke]="ring.color"
        />
        <g [attr.clip-path]="'url(#' + uid + '-r)'">
          <path
            class="arc arc-a"
            [attr.d]="ring.left"
            [attr.stroke-width]="stroke"
            [style.stroke]="ring.color"
            [style.--rot]="ring.a + 'deg'"
            [style.--dur]="ring.durA + 'ms'"
            [style.--delay]="ring.delay + 'ms'"
            [style.--ease]="ring.b > 0 ? 'var(--ds-ease-in)' : 'var(--ds-ease-spring-gentle)'"
          />
        </g>
        <g [attr.clip-path]="'url(#' + uid + '-l)'">
          <path
            class="arc arc-b"
            [attr.d]="ring.right"
            [attr.stroke-width]="stroke"
            [style.stroke]="ring.color"
            [style.--rot]="ring.b + 'deg'"
            [style.--dur]="ring.durB + 'ms'"
            [style.--delay]="ring.delay + ring.durA + 'ms'"
            [style.--ease]="'var(--ds-ease-spring-gentle)'"
          />
        </g>
      }
    </svg>

    @if (showLegend()) {
      <ul class="legend">
        @for (ring of rings(); track ring.key) {
          <li>
            <span class="swatch" [style.background]="ring.color" aria-hidden="true"></span>
            <span class="name">{{ ring.label }}</span>
            <span class="pct ds-tabular">{{ ring.value }}</span>
          </li>
        }
      </ul>
    }
  `,
  styleUrl: './health-rings.css',
})
export class DsHealthRings {
  readonly acquisition = input.required<number>();
  readonly engagement = input.required<number>();
  readonly conversion = input.required<number>();
  readonly size = input(168);
  readonly showLegend = input(true);

  protected readonly uid = `ds-rings-${nextId++}`;
  protected readonly stroke = STROKE;
  protected readonly drawn = signal(false);

  protected readonly rings = computed<RingView[]>(() => {
    const defs = [
      { key: 'acquisition', label: 'Aquisição', value: this.acquisition(), color: 'var(--ds-ring-acquisition)' },
      { key: 'engagement', label: 'Engajamento', value: this.engagement(), color: 'var(--ds-ring-engagement)' },
      { key: 'conversion', label: 'Conversão', value: this.conversion(), color: 'var(--ds-ring-conversion)' },
    ] as const;

    return defs.map((def, i) => {
      const value = Math.round(clampPercent(def.value));
      const { a, b } = ringAngles(value);
      const r = RADII[i];
      return {
        ...def,
        value,
        r,
        left: leftHalfPath(r),
        right: rightHalfPath(r),
        a,
        b,
        durA: Math.round((a / 180) * HALF_SWEEP_MS),
        durB: Math.round((b / 180) * HALF_SWEEP_MS),
        delay: i * 90,
      };
    });
  });

  protected readonly ariaLabel = computed(() =>
    `Saúde da conta: ${this.rings()
      .map((r) => `${r.label} ${r.value} de 100`)
      .join(', ')}`,
  );

  constructor() {
    // Desenha depois do primeiro paint para a transição partir de 0°.
    afterNextRender(() => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => this.drawn.set(true));
      } else {
        this.drawn.set(true);
      }
    });
  }
}
