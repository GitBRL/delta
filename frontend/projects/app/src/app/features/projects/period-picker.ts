import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { CompareMode, DateRange } from '../../core/api/api.types';
import {
  COMPARE_OPTIONS,
  PERIOD_PRESETS,
  PeriodPreset,
  lastAvailableDay,
  resolvePreset,
  toIsoDate,
} from '../../core/metrics/period';

/** Seletor de período (presets + personalizado) e de comparação. Nunca passa de ontem. */
@Component({
  selector: 'app-period-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="presets" role="radiogroup" aria-label="Período">
      @for (p of presets; track p.value) {
        <button
          type="button"
          role="radio"
          class="preset"
          [attr.aria-checked]="preset() === p.value"
          [disabled]="!available()(p.value)"
          [title]="available()(p.value) ? '' : 'Ainda não há dias com dados neste mês'"
          (click)="preset.set(p.value)"
        >
          {{ p.label }}
        </button>
      }
    </div>

    <div class="row">
      @if (preset() === 'custom') {
        <label class="field">
          <span>De</span>
          <input type="date" [max]="maxDate()" [value]="custom().start" (change)="setCustom('start', $event)" />
        </label>
        <label class="field">
          <span>Até</span>
          <input type="date" [max]="maxDate()" [value]="custom().end" (change)="setCustom('end', $event)" />
        </label>
      }
      <label class="field">
        <span>Comparar com</span>
        <select [value]="compare()" (change)="setCompare($event)">
          @for (o of compareOptions; track o.value) {
            <option [value]="o.value" [selected]="o.value === compare()">{{ o.label }}</option>
          }
        </select>
      </label>
    </div>

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .presets {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 2px;
      padding: 3px;
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
      width: fit-content;
    }
    .preset {
      padding: 6px 12px;
      border: 0;
      border-radius: var(--ds-radius-sm);
      background: transparent;
      color: var(--ds-text-secondary);
      font: var(--ds-text-footnote);
      font-weight: 600;
      cursor: pointer;
      transition: background-color var(--ds-duration-fast) var(--ds-ease-out);
    }
    .preset[aria-checked='true'] {
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      box-shadow: var(--ds-shadow-1);
    }
    .preset:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-3);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .field input,
    .field select {
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
    }
    .error {
      margin: 0;
      font: var(--ds-text-footnote);
      color: var(--ds-status-critical);
    }
  `,
})
export class PeriodPicker {
  readonly preset = model<PeriodPreset>('last_30');
  readonly custom = model<DateRange>({ start: '', end: '' });
  readonly compare = model<CompareMode>('previous_period');
  /** Mensagem de validação do intervalo (vinda de quem calcula o período). */
  readonly error = input<string | null>(null);
  /** Injetável para testes. */
  readonly today = input<Date>(new Date());

  protected readonly presets = PERIOD_PRESETS;
  protected readonly compareOptions = COMPARE_OPTIONS;
  protected readonly maxDate = computed(() => toIsoDate(lastAvailableDay(this.today())));
  protected readonly available = computed(() => {
    const today = this.today();
    return (p: PeriodPreset) => p === 'custom' || resolvePreset(p, today) !== null;
  });

  protected setCustom(edge: keyof DateRange, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.custom.update((range) => ({ ...range, [edge]: value }));
  }

  protected setCompare(event: Event): void {
    this.compare.set((event.target as HTMLSelectElement).value as CompareMode);
  }
}
