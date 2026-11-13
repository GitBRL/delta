import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FormulaToken, tokenizeFormula } from '../../core/metrics/formula';

const OPERATOR_DISPLAY: Record<string, string> = { '*': '×', '/': '÷', '-': '−', '+': '+' };
const OPERATOR_SPOKEN: Record<string, string> = { '*': 'vezes', '/': 'dividido por', '-': 'menos', '+': 'mais' };

interface ChipPart {
  type: FormulaToken['type'];
  text: string;
  display: string;
  known: boolean;
}

/**
 * Fórmula "traduzida" em chips: referências viram o nome da métrica em pt-BR,
 * operadores viram símbolos legíveis (× ÷ −). Somente leitura.
 */
@Component({
  selector: 'app-formula-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="chips" role="img" [attr.aria-label]="spoken()">
      @for (p of parts(); track $index) {
        @switch (p.type) {
          @case ('ref') {
            <span
              class="chip ref"
              [class.unknown]="!p.known"
              [class.spring]="animate()"
              [title]="p.text"
              [style.animation-delay.ms]="$index * 25"
              >{{ p.display }}</span
            >
          }
          @case ('function') {
            <span class="chip fn" [class.unknown]="!p.known" [class.spring]="animate()">{{ p.display }}</span>
          }
          @case ('operator') {
            <span class="op">{{ p.display }}</span>
          }
          @default {
            <span class="sym">{{ p.display }}</span>
          }
        }
      }
    </span>
  `,
  styles: `
    .chips {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      font: var(--ds-text-footnote);
      line-height: 1.6;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      padding: 1px 8px;
      border-radius: 999px;
      font-weight: 600;
      white-space: nowrap;
    }
    .ref {
      background: var(--ds-accent-soft);
      color: var(--ds-accent);
    }
    .fn {
      background: color-mix(in oklch, var(--ds-ring-acquisition) 14%, transparent);
      color: var(--ds-ring-acquisition);
      font-family: var(--ds-font-mono, ui-monospace, monospace);
    }
    .unknown {
      background: color-mix(in oklch, var(--ds-status-critical) 14%, transparent);
      color: var(--ds-status-critical);
      text-decoration: underline wavy;
    }
    .op {
      padding: 0 2px;
      color: var(--ds-text-secondary);
      font-weight: 700;
    }
    .sym {
      color: var(--ds-text-tertiary);
      font-family: var(--ds-font-mono, ui-monospace, monospace);
    }
    .spring {
      animation: chip-in var(--ds-duration-slower) var(--ds-ease-spring) both;
    }
    @keyframes chip-in {
      from {
        opacity: 0;
        transform: scale(0.6) translateY(4px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
  `,
})
export class FormulaChips {
  readonly formula = input.required<string>();
  /** Chave → rótulo pt-BR. Vazio = não marca referências como desconhecidas. */
  readonly labels = input<ReadonlyMap<string, string>>(new Map());
  /** Chips "encaixam" com mola ao aparecer (desligado por quem prefere menos movimento, via tokens). */
  readonly animate = input(false);

  protected readonly parts = computed<ChipPart[]>(() => {
    const labels = this.labels();
    const checkRefs = labels.size > 0;
    return tokenizeFormula(this.formula())
      .filter((t) => t.type !== 'space')
      .map((t) => ({
        type: t.type,
        text: t.text,
        display:
          t.type === 'ref'
            ? (labels.get(t.text) ?? t.text)
            : t.type === 'operator'
              ? OPERATOR_DISPLAY[t.text]
              : t.text,
        known: t.type === 'ref' ? !checkRefs || labels.has(t.text) : t.type === 'function' ? t.known !== false : true,
      }));
  });

  protected readonly spoken = computed(() =>
    this.parts()
      .map((p) => (p.type === 'operator' ? OPERATOR_SPOKEN[p.text] : p.display))
      .join(' '),
  );
}
