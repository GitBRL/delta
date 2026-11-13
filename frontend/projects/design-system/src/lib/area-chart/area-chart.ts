import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ChartPoint, buildChartGeometry, nearestIndex } from './chart-geometry';

let nextId = 0;

const DEFAULT_VALUE_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** Marco no eixo do tempo (ex.: "Campanha de Black Friday no ar"), desenhado como linha tracejada. */
export interface ChartMarker {
  /** YYYY-MM-DD (dia da série atual). */
  date: string;
  label: string;
}

/** "2026-11-05" → "05/11" (data local, sem fuso). */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
}

/** "2026-11-05" → "05/11/2026". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/**
 * Gráfico de área em SVG puro: série atual (área com gradiente + linha) e série de comparação
 * (linha tracejada), alinhadas por índice.
 *
 * Interação: ponteiro ou teclado (← → Home End Esc) mostram o tooltip; um anúncio "polite"
 * descreve o ponto ativo. Para leitores de tela também há uma tabela oculta com todos os pontos.
 * Marcos (`markers`) viram linhas verticais tracejadas; o rótulo aparece no tooltip e no anúncio
 * quando o dia do marco fica ativo (ponteiro ou teclado).
 * A linha "se desenha" na entrada (stroke-dashoffset); com movimento reduzido aparece pronta.
 */
@Component({
  selector: 'ds-area-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ds-area-chart' },
  template: `
    @if (geometry(); as g) {
      <div
        #frame
        class="frame"
        tabindex="0"
        role="img"
        [attr.aria-label]="summary()"
        [style.height.px]="height()"
        (pointermove)="onPointer($event)"
        (pointerleave)="active.set(null)"
        (keydown)="onKey($event)"
        (blur)="active.set(null)"
      >
        <svg
          class="svg"
          [attr.width]="g.width"
          [attr.height]="g.height"
          [attr.viewBox]="'0 0 ' + g.width + ' ' + g.height"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" class="stop-top" />
              <stop offset="100%" class="stop-bottom" />
            </linearGradient>
          </defs>

          @for (tick of g.yTicks; track tick.value) {
            <line class="grid" [attr.x1]="g.plot.left" [attr.x2]="g.plot.right" [attr.y1]="tick.y" [attr.y2]="tick.y" />
            <text class="axis y" [attr.x]="g.plot.left - 8" [attr.y]="tick.y">{{ format(tick.value) }}</text>
          }

          <!-- Recria os traços quando os dados mudam, para a animação de entrada tocar de novo. -->
          @for (data of [series()]; track data) {
            <path class="area" [attr.d]="g.areaPath" [attr.fill]="'url(#' + gradientId + ')'" />
            @if (g.comparisonPath) {
              <path class="comparison" [attr.d]="g.comparisonPath" />
            }
            <path class="line" [attr.d]="g.linePath" pathLength="1" />
          }

          @for (m of markerViews(); track m.index) {
            <line class="marker" [attr.x1]="m.x" [attr.x2]="m.x" [attr.y1]="g.plot.top" [attr.y2]="g.plot.bottom" />
            <circle class="marker-flag" [attr.cx]="m.x" [attr.cy]="g.plot.top + 3" r="3.5" />
          }

          @for (tick of g.xTicks; track tick.index) {
            <text class="axis x" [attr.x]="tick.x" [attr.y]="g.height - 8">{{ dateFormatter()(tick.date) }}</text>
          }

          @if (activeView(); as a) {
            <line class="guide" [attr.x1]="a.x" [attr.x2]="a.x" [attr.y1]="g.plot.top" [attr.y2]="g.plot.bottom" />
            @if (a.previousY !== null) {
              <circle class="dot previous" [attr.cx]="a.x" [attr.cy]="a.previousY" r="4" />
            }
            @if (a.y !== null) {
              <circle class="dot" [attr.cx]="a.x" [attr.cy]="a.y" r="5" />
            }
          }
        </svg>

        @if (activeView(); as a) {
          <div class="tooltip" aria-hidden="true" [style.transform]="'translate(' + a.tooltipX + 'px, 0) translateX(-50%)'">
            <p class="tip-date">{{ a.date }}</p>
            <p class="tip-row">
              <span class="swatch current"></span>{{ seriesLabel() }}
              <strong>{{ a.valueText }}</strong>
            </p>
            @if (hasComparison()) {
              <p class="tip-row">
                <span class="swatch previous"></span>{{ comparisonLabel() }}
                <strong>{{ a.previousText }}</strong>
              </p>
            }
            @for (label of a.markers; track $index) {
              <p class="tip-marker"><span class="flag" aria-hidden="true">⚑</span>{{ label }}</p>
            }
          </div>
        }
      </div>

      <p class="ds-visually-hidden" aria-live="polite">{{ announcement() }}</p>

      <table class="ds-visually-hidden">
        <caption>{{ label() }}</caption>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">{{ seriesLabel() }}</th>
            @if (hasComparison()) {
              <th scope="col">{{ comparisonLabel() }}</th>
            }
            @if (markers().length) {
              <th scope="col">Marcos</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (p of series(); track p.date; let i = $index) {
            <tr>
              <th scope="row">{{ longDate(p.date) }}</th>
              <td>{{ formatNullable(p.value) }}</td>
              @if (hasComparison()) {
                <td>{{ formatNullable(comparison()[i]?.value ?? null) }}</td>
              }
              @if (markers().length) {
                <td>{{ markerLabels().get(p.date)?.join('; ') ?? '' }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    } @else {
      <p class="empty" [style.height.px]="height()">Sem dados no período.</p>
    }
  `,
  styleUrl: './area-chart.css',
})
export class DsAreaChart {
  readonly series = input.required<readonly ChartPoint[]>();
  readonly comparison = input<readonly ChartPoint[]>([]);
  /** Nome da métrica (resumo acessível e legenda da tabela). */
  readonly label = input.required<string>();
  readonly valueFormatter = input<(value: number) => string>((v) => DEFAULT_VALUE_FORMAT.format(v));
  readonly dateFormatter = input<(iso: string) => string>(shortDate);
  readonly seriesLabel = input('Período atual');
  readonly comparisonLabel = input('Período anterior');
  readonly height = input(240);
  /** Marcos da linha do tempo (dias fora da série são ignorados). */
  readonly markers = input<readonly ChartMarker[]>([]);

  protected readonly gradientId = `ds-area-gradient-${++nextId}`;
  protected readonly longDate = longDate;

  /** Largura medida do contêiner (ResizeObserver); valor inicial para ambientes sem layout. */
  readonly width = signal(640);
  readonly active = signal<number | null>(null);

  private readonly frame = viewChild<ElementRef<HTMLElement>>('frame');

  protected readonly hasComparison = computed(() => this.comparison().some((p) => p.value !== null));

  readonly geometry = computed(() =>
    this.series().length === 0
      ? null
      : buildChartGeometry(this.series(), this.comparison(), { width: this.width(), height: this.height() }),
  );

  /** Rótulos dos marcos por dia (vários no mesmo dia viram uma lista). */
  readonly markerLabels = computed(() => {
    const byDate = new Map<string, string[]>();
    for (const m of this.markers()) {
      const list = byDate.get(m.date) ?? [];
      list.push(m.label);
      byDate.set(m.date, list);
    }
    return byDate;
  });

  /** Posição x de cada dia com marco (pela série atual). */
  readonly markerViews = computed(() => {
    const g = this.geometry();
    const labels = this.markerLabels();
    if (!g || labels.size === 0) return [];
    return g.points.filter((p) => labels.has(p.date)).map((p) => ({ index: p.index, x: p.x, labels: labels.get(p.date) ?? [] }));
  });

  protected readonly activeView = computed(() => {
    const g = this.geometry();
    const index = this.active();
    if (!g || index === null) return null;

    const point = g.points[index] ?? null;
    const previous = g.comparisonPoints[index] ?? null;
    const x = point?.x ?? previous?.x ?? 0;
    const half = 90;

    return {
      x,
      y: point?.y ?? null,
      previousY: previous?.y ?? null,
      date: point ? longDate(point.date) : previous ? longDate(previous.date) : '',
      markers: point ? (this.markerLabels().get(point.date) ?? []) : [],
      valueText: this.formatNullable(point?.value ?? null),
      previousText: this.formatNullable(previous?.value ?? null),
      tooltipX: Math.min(Math.max(x, half), g.width - half),
    };
  });

  protected readonly announcement = computed(() => {
    const a = this.activeView();
    if (!a) return '';
    const previous = this.hasComparison() ? `; ${this.comparisonLabel()}: ${a.previousText}` : '';
    const markers = a.markers.length ? `. Marco: ${a.markers.join('; ')}` : '';
    return `${a.date}: ${a.valueText}${previous}${markers}`;
  });

  readonly summary = computed(() => {
    const points = this.series();
    const values = points.map((p) => p.value).filter((v): v is number => v !== null && Number.isFinite(v));
    const first = points[0]?.date;
    const last = points[points.length - 1]?.date;
    const range = first && last ? ` de ${longDate(first)} a ${longDate(last)}` : '';
    if (!values.length) {
      return `${this.label()}: sem valores${range}.`;
    }
    const lastValue = values[values.length - 1];
    const comparison = this.hasComparison()
      ? ` Linha tracejada: ${this.comparisonLabel().toLowerCase()}.`
      : '';
    const count = this.markerViews().length;
    const markers = count ? ` ${count} ${count === 1 ? 'marco' : 'marcos'} no período.` : '';
    return (
      `${this.label()}${range}. Mínimo ${this.format(Math.min(...values))}, ` +
      `máximo ${this.format(Math.max(...values))}, último ${this.format(lastValue)}.${comparison}${markers} ` +
      'Use as setas para percorrer os dias.'
    );
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const el = this.frame()?.nativeElement;
      if (!el) return;
      if (el.clientWidth > 0) this.width.set(el.clientWidth);
      if (typeof ResizeObserver === 'undefined') return;

      const observer = new ResizeObserver((entries) => {
        const w = Math.round(entries[0]?.contentRect.width ?? 0);
        if (w > 0 && w !== this.width()) this.width.set(w);
      });
      observer.observe(el);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected format(value: number): string {
    return this.valueFormatter()(value);
  }

  protected formatNullable(value: number | null): string {
    return value === null || !Number.isFinite(value) ? '—' : this.format(value);
  }

  protected onPointer(event: PointerEvent): void {
    const g = this.geometry();
    const el = event.currentTarget as HTMLElement | null;
    if (!g || !el) return;
    const rect = el.getBoundingClientRect();
    const scale = rect.width > 0 ? g.width / rect.width : 1;
    this.active.set(nearestIndex((event.clientX - rect.left) * scale, g));
  }

  protected onKey(event: KeyboardEvent): void {
    const g = this.geometry();
    if (!g) return;
    const last = g.slots - 1;
    const current = this.active();

    switch (event.key) {
      case 'ArrowRight':
        this.active.set(current === null ? 0 : Math.min(last, current + 1));
        break;
      case 'ArrowLeft':
        this.active.set(current === null ? last : Math.max(0, current - 1));
        break;
      case 'Home':
        this.active.set(0);
        break;
      case 'End':
        this.active.set(last);
        break;
      case 'Escape':
        this.active.set(null);
        break;
      default:
        return;
    }
    event.preventDefault();
  }
}
