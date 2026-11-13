import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideArrowDownRight, LucideRefreshCw } from '@lucide/angular';
import { DsButton, DsSkeleton, DsStatusBadge } from 'design-system';
import { AttentionResult, AttentionSignal } from '../../core/api/api.types';
import { sortSignals, summaryChips } from '../../core/attention/attention';
import { benchmarkBar, historyText, signalSource } from './signal-detail';

/**
 * Radar de atenção do projeto (§7.2): resumo por estado e um card por sinal, com o porquê e
 * "O que fazer". Só apresenta; quem busca (POST /attention) é a tela.
 */
@Component({
  selector: 'app-attention-radar',
  imports: [DsButton, DsSkeleton, DsStatusBadge, LucideArrowDownRight, LucideRefreshCw],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <div>
        <h2 id="radar-title" class="m-0 text-title-3 font-semibold">Radar de atenção</h2>
        <p class="m-0 text-footnote text-fg-muted">Boas práticas e metas, comparando com o período anterior.</p>
      </div>
      @if (chips().length) {
        <ul class="summary" aria-label="Resumo do radar">
          @for (chip of chips(); track chip.status) {
            <li class="summary-chip" [attr.data-status]="chip.status">
              <ds-status-badge [status]="chip.status" [compact]="true" [pulse]="false" />
              {{ chip.text }}
            </li>
          }
        </ul>
      }
    </div>

    @if (error()) {
      <div class="state ds-glass" role="alert">
        <p class="m-0 text-subhead font-semibold">{{ error() }}</p>
        <button ds-button variant="secondary" size="sm" (click)="retry.emit()">
          <svg lucideRefreshCw [size]="14"></svg>
          Tentar de novo
        </button>
      </div>
    } @else if (loading() && !result()) {
      <div class="signals" aria-busy="true" aria-label="Carregando o radar">
        @for (i of [1, 2]; track i) {
          <div class="signal ds-glass">
            <ds-skeleton width="40%" height="14px" />
            <ds-skeleton width="90%" />
            <ds-skeleton width="70%" />
          </div>
        }
      </div>
    } @else if (result()) {
      @if (signals().length === 0) {
        <div class="healthy ds-glass" animate.enter="ds-enter-fade-up">
          <span class="halo" aria-hidden="true"></span>
          <ds-status-badge status="healthy" label="Saudável" />
          <p class="m-0 text-headline">Tudo saudável neste período</p>
          <p class="m-0 text-footnote text-fg-muted">Nenhuma regra de boas práticas ou meta foi disparada.</p>
        </div>
      } @else {
        <ul class="signals" [attr.aria-busy]="loading()" aria-labelledby="radar-title">
          @for (s of signals(); track s.rule; let i = $index) {
            <li>
              <article
                class="signal ds-glass"
                [attr.data-status]="s.status"
                [class.clickable]="isSelectable(s)"
                [attr.role]="isSelectable(s) ? 'button' : null"
                [attr.tabindex]="isSelectable(s) ? 0 : null"
                [attr.aria-pressed]="isSelectable(s) ? selectedMetric() === s.metric : null"
                [style.animation-delay.ms]="i * 50"
                (click)="pick(s)"
                (keydown.enter)="pick(s)"
                (keydown.space)="$event.preventDefault(); pick(s)"
              >
                @if (source(s); as src) {
                  <span class="source" [attr.data-source]="s.rule.split('.')[0]">{{ src }}</span>
                }
                <header class="signal-head">
                  <ds-status-badge [status]="s.status" />
                  <h3 class="m-0 text-subhead font-semibold">{{ s.title }}</h3>
                </header>
                <p class="m-0 text-footnote">{{ s.explanation }}</p>
                @if (bar(s); as b) {
                  <div class="bench" role="img" [attr.aria-label]="b.rangeText + '. ' + b.valueText">
                    <div class="bench-track">
                      <span class="bench-band" [style.left.%]="b.bandStart * 100" [style.width.%]="(b.bandEnd - b.bandStart) * 100"></span>
                      <span class="bench-median" [style.left.%]="b.median * 100"></span>
                      <span class="bench-value" [style.left.%]="b.value * 100"></span>
                    </div>
                    <p class="m-0 text-caption text-fg-muted">{{ b.rangeText }} · {{ b.valueText }}</p>
                  </div>
                }
                @if (history(s); as h) {
                  <p class="m-0 text-caption text-fg-muted ds-tabular">{{ h }}</p>
                }
                <div class="todo">
                  <span class="todo-label">O que fazer</span>
                  <p class="m-0 text-footnote">{{ s.suggestion }}</p>
                </div>
                <div class="signal-foot">
                  @if (isSelectable(s)) {
                    <span class="see" aria-hidden="true">
                      Ver no gráfico
                      <svg lucideArrowDownRight [size]="14"></svg>
                    </span>
                  }
                  @if (canCreateAction()) {
                    <button
                      ds-button
                      variant="ghost"
                      size="sm"
                      class="create-action"
                      (click)="$event.stopPropagation(); actionCreate.emit(s)"
                      (keydown.enter)="$event.stopPropagation()"
                      (keydown.space)="$event.stopPropagation()"
                    >
                      Criar ação
                    </button>
                  }
                </div>
              </article>
            </li>
          }
        </ul>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--ds-space-3);
    }
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .summary-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: var(--ds-radius-full);
      background: color-mix(in oklch, var(--chip-color) 14%, transparent);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
      font-weight: 600;
    }
    [data-status='critical'] {
      --chip-color: var(--ds-status-critical);
      --signal-color: var(--ds-status-critical);
    }
    [data-status='attention'] {
      --chip-color: var(--ds-status-attention);
      --signal-color: var(--ds-status-attention);
    }
    [data-status='opportunity'] {
      --chip-color: var(--ds-status-opportunity);
      --signal-color: var(--ds-status-opportunity);
    }
    .signals {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: var(--ds-space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .signals[aria-busy='true'] {
      opacity: 0.6;
      transition: opacity var(--ds-duration-base) ease;
    }
    .signal {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      height: 100%;
      padding: var(--ds-space-4) var(--ds-space-4) var(--ds-space-4) calc(var(--ds-space-4) + 4px);
      border-radius: var(--ds-radius-lg);
      overflow: hidden;
      animation: ds-fade-up var(--ds-duration-slow) var(--ds-ease-spring-gentle) both;
    }
    .signal::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      background: var(--signal-color, var(--ds-separator));
    }
    .signal.clickable {
      cursor: pointer;
      transition: transform var(--ds-duration-base) var(--ds-ease-spring-gentle);
    }
    .signal.clickable:hover {
      transform: translateY(-2px);
    }
    .signal[aria-pressed='true'] {
      box-shadow: 0 0 0 2px var(--signal-color, var(--ds-accent));
    }
    .signal-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .todo {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: var(--ds-space-2) var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
    }
    .todo-label {
      font: var(--ds-text-caption);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--ds-text-secondary);
    }
    .source {
      font: var(--ds-text-caption);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--ds-text-tertiary);
    }
    .bench {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .bench-track {
      position: relative;
      height: 8px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-fill);
    }
    .bench-band {
      position: absolute;
      top: 0;
      bottom: 0;
      border-radius: var(--ds-radius-full);
      background: color-mix(in oklch, var(--ds-status-healthy) 35%, transparent);
    }
    .bench-median {
      position: absolute;
      top: -2px;
      width: 2px;
      height: 12px;
      margin-left: -1px;
      background: var(--ds-status-healthy);
    }
    .bench-value {
      position: absolute;
      top: -3px;
      width: 14px;
      height: 14px;
      margin-left: -7px;
      border: 2px solid var(--ds-bg-elevated);
      border-radius: 50%;
      background: var(--signal-color, var(--ds-accent));
    }
    .signal-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-2);
      margin-top: auto;
    }
    .create-action {
      margin-left: auto;
    }
    .see {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--ds-accent);
      font: var(--ds-text-footnote);
      font-weight: 600;
    }
    .state,
    .healthy {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--ds-space-2);
      padding: var(--ds-space-8) var(--ds-space-6);
      border-radius: var(--ds-radius-xl);
      text-align: center;
      overflow: hidden;
    }
    .halo {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 220px;
      height: 220px;
      margin: -110px 0 0 -110px;
      border-radius: 50%;
      background: radial-gradient(circle, color-mix(in oklch, var(--ds-status-healthy) 22%, transparent), transparent 70%);
      animation: radar-breathe 4.8s ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes radar-breathe {
      0%,
      100% {
        transform: scale(0.85);
        opacity: 0.55;
      }
      50% {
        transform: scale(1.05);
        opacity: 1;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .halo,
      .signal {
        animation: none;
      }
      .signal.clickable:hover {
        transform: none;
      }
    }
  `,
})
export class AttentionRadar {
  readonly result = input<AttentionResult | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  /** Métricas presentes na grade de KPIs: só os sinais delas são clicáveis. */
  readonly selectableMetrics = input<readonly string[]>([]);
  readonly selectedMetric = input<string | null>(null);

  /** Equipe: cada sinal ganha "Criar ação" (vira item do plano de ação). */
  readonly canCreateAction = input(false);

  /** Métrica do sinal escolhido (a tela seleciona o KPI e mostra o gráfico). */
  readonly metricSelect = output<string>();
  /** "Criar ação" num sinal. */
  readonly actionCreate = output<AttentionSignal>();
  readonly retry = output<void>();

  protected readonly chips = computed(() => {
    const result = this.result();
    return result ? summaryChips(result.summary) : [];
  });
  protected readonly signals = computed(() => sortSignals(this.result()?.signals ?? []));
  private readonly selectable = computed(() => new Set(this.selectableMetrics()));

  protected source(signal: AttentionSignal): string | null {
    return signalSource(signal.rule);
  }

  protected bar(signal: AttentionSignal) {
    return signal.rule.startsWith('benchmark.') ? benchmarkBar(signal.evidence) : null;
  }

  protected history(signal: AttentionSignal): string | null {
    return signal.rule.startsWith('history.') ? historyText(signal.evidence) : null;
  }

  protected isSelectable(signal: AttentionSignal): boolean {
    return this.selectable().has(signal.metric);
  }

  protected pick(signal: AttentionSignal): void {
    if (this.isSelectable(signal)) {
      this.metricSelect.emit(signal.metric);
    }
  }
}
