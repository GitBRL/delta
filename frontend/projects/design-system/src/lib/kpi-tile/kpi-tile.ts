import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { animateNumber } from '../motion/motion';
import { StatusLevel } from '../status-badge/status';
import { DsStatusBadge } from '../status-badge/status-badge';
import { KpiDirection, KpiFormat, TrendSentiment, formatKpiValue, formatTrend } from './kpi-format';

/**
 * Indicador com contagem animada, tendência ▲▼ (com sentido "bom" configurável) e selo do semáforo.
 * `value` nulo mostra "—" (ex.: projeto sem conta daquele canal). `formatter` substitui `format`
 * quando a formatação vem de fora (ex.: unidade e casas decimais do catálogo de métricas).
 */
@Component({
  selector: 'ds-kpi-tile',
  imports: [DsStatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ds-kpi-tile' },
  template: `
    <div class="head">
      <span class="label">{{ label() }}</span>
      @if (status(); as s) {
        <!-- Estados que pedem ação ou são oportunidade pulsam suavemente; saudável fica discreto. -->
        <ds-status-badge [status]="s" [compact]="true" [pulse]="s !== 'healthy'" />
      }
    </div>

    <div
      class="value ds-tabular"
      [attr.aria-label]="label() + ': ' + (approximate() ? 'aproximadamente ' : '') + finalText()"
    >
      @if (approximate()) {
        <span class="approx" aria-hidden="true" title="Valor aproximado">≈</span>
      }
      <span aria-hidden="true">{{ displayText() }}</span>
    </div>

    @if (trendView(); as t) {
      <div class="trend" [attr.data-sentiment]="t.sentiment" [attr.aria-label]="t.description">
        <span class="arrow" aria-hidden="true">{{ t.arrow }}</span>
        <span aria-hidden="true">{{ t.text }}</span>
        <span class="caption" aria-hidden="true">{{ comparisonLabel() }}</span>
      </div>
    }

    @if (hint()) {
      <p class="hint">{{ hint() }}</p>
    }
  `,
  styleUrl: './kpi-tile.css',
})
export class DsKpiTile {
  readonly label = input.required<string>();
  readonly value = input.required<number | null>();
  readonly format = input<KpiFormat>('number');
  /** Formatação externa; quando presente, ignora `format` e `currency`. */
  readonly formatter = input<((value: number) => string) | null>(null);
  readonly currency = input('BRL');
  /** Variação relativa ao período anterior (0.08 = +8%). */
  readonly trend = input<number | null>(null);
  readonly direction = input<KpiDirection>('up-is-good');
  /** Sentimento da variação decidido fora (ex.: pela API); prevalece sobre `direction`. */
  readonly sentiment = input<TrendSentiment | null>(null);
  /** Marca o valor como aproximado (≈), ex.: métricas não aditivas estimadas. */
  readonly approximate = input(false);
  readonly status = input<StatusLevel | null>(null);
  readonly hint = input<string>();
  readonly comparisonLabel = input('vs período anterior');
  readonly durationMs = input(900);

  private readonly displayed = signal(0);

  protected readonly displayText = computed(() =>
    this.value() === null ? '—' : this.formatValue(this.displayed()),
  );
  protected readonly finalText = computed(() => {
    const value = this.value();
    return value === null ? 'sem dados' : this.formatValue(value);
  });
  protected readonly trendView = computed(() => {
    const t = this.trend();
    return t === null || this.value() === null
      ? null
      : formatTrend(t, this.direction(), this.sentiment());
  });

  constructor() {
    let cancel: () => void = () => undefined;
    inject(DestroyRef).onDestroy(() => cancel());

    effect(() => {
      const target = this.value();
      const duration = this.durationMs();
      cancel();
      if (target === null) {
        return;
      }
      // untracked: o efeito depende só do valor-alvo, não de cada frame da animação.
      const from = untracked(() => this.displayed());
      cancel = animateNumber(from, target, duration, (v) => this.displayed.set(v));
    });
  }

  private formatValue(value: number): string {
    const formatter = this.formatter();
    return formatter ? formatter(value) : formatKpiValue(value, this.format(), this.currency());
  }
}
