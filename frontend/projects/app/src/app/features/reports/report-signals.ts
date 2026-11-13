import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DsStatusBadge } from 'design-system';
import { AttentionSignal } from '../../core/api/api.types';
import { sortSignals } from '../../core/attention/attention';

/** Bloco "Atenção" do relatório: sinais do semáforo com o porquê e o que fazer. */
@Component({
  selector: 'app-report-signals',
  imports: [DsStatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sorted().length === 0) {
      <div class="all-good">
        <ds-status-badge status="healthy" label="Saudável" [pulse]="false" />
        <p>Nenhum ponto de atenção no período: os indicadores avaliados estão dentro das boas práticas.</p>
      </div>
    } @else {
      <ul class="signals">
        @for (s of sorted(); track s.rule) {
          <li class="signal" [attr.data-status]="s.status">
            <div class="signal-head">
              <ds-status-badge [status]="s.status" [pulse]="false" />
              <h4>{{ s.title }}</h4>
            </div>
            <p class="explanation">{{ s.explanation }}</p>
            @if (s.suggestion) {
              <p class="todo"><span>O que fazer</span>{{ s.suggestion }}</p>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
.all-good {
  display: flex;
  align-items: center;
  gap: var(--ds-space-3);
  padding: var(--ds-space-4);
  border-radius: var(--ds-radius-lg);
  background: color-mix(in oklch, var(--ds-status-healthy) 12%, transparent);
}
.all-good p {
  margin: 0;
  font: var(--ds-text-footnote);
}
.signals {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--ds-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.signal {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-2);
  padding: var(--ds-space-4) var(--ds-space-4) var(--ds-space-4) calc(var(--ds-space-4) + 4px);
  border-radius: var(--ds-radius-lg);
  background: var(--ds-fill);
  overflow: hidden;
  break-inside: avoid;
}
.signal::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--signal-color, var(--ds-separator));
}
.signal[data-status='critical'] {
  --signal-color: var(--ds-status-critical);
}
.signal[data-status='attention'] {
  --signal-color: var(--ds-status-attention);
}
.signal[data-status='opportunity'] {
  --signal-color: var(--ds-status-opportunity);
}
.signal-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ds-space-2);
}
.signal h4 {
  margin: 0;
  font: var(--ds-text-subhead);
  font-weight: 600;
}
.explanation {
  margin: 0;
  font: var(--ds-text-footnote);
}
.todo {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: var(--ds-space-2) var(--ds-space-3);
  border-radius: var(--ds-radius-md);
  background: var(--ds-bg-elevated);
  font: var(--ds-text-footnote);
}
.todo span {
  font: var(--ds-text-caption);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ds-text-secondary);
}
  `,
})
export class ReportSignals {
  readonly signals = input.required<readonly AttentionSignal[]>();
  protected readonly sorted = computed(() => sortSignals(this.signals()));
}
