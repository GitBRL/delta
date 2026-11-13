import { ChangeDetectionStrategy, Component, computed, effect, input, model, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { LucidePencil, LucideTarget } from '@lucide/angular';
import { DsButton, DsTextField } from 'design-system';
import { ProjectGoals, UpdateProjectBody } from '../../core/api/api.types';
import {
  GoalsForm,
  breakEvenExplanation,
  buildGoalsBody,
  goalsToForm,
  parseDecimal,
  validateGoals,
} from '../../core/attention/attention';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/**
 * Metas do projeto (margem bruta, meta de CPA, meta de ROAS), que calibram o semáforo.
 * Equipe da agência edita; cliente só vê. Quem salva (PATCH) é a tela, via `save`.
 */
@Component({
  selector: 'app-project-goals',
  imports: [ReactiveFormsModule, DsButton, DsTextField, LucidePencil, LucideTarget],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h2 class="m-0 text-headline">Metas do projeto</h2>
      @if (canEdit() && !editing()) {
        <button ds-button variant="ghost" size="sm" (click)="startEditing()">
          <svg lucidePencil [size]="14"></svg>
          Editar
        </button>
      }
    </div>

    @if (editing()) {
      <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <ds-text-field
          label="Margem bruta (%)"
          name="gross_margin_pct"
          inputmode="decimal"
          autocomplete="off"
          placeholder="Ex.: 40"
          formControlName="gross_margin_pct"
          [error]="errorFor('gross_margin_pct')"
        />
        @if (explanation(); as text) {
          <p class="effect m-0 text-footnote" aria-live="polite" animate.enter="ds-enter-fade-up">{{ text }}</p>
        }
        <ds-text-field
          label="Meta de CPA (R$)"
          name="target_cpa"
          inputmode="decimal"
          autocomplete="off"
          placeholder="Ex.: 75,00"
          formControlName="target_cpa"
          [error]="errorFor('target_cpa')"
        />
        <ds-text-field
          label="Meta de ROAS"
          name="target_roas"
          inputmode="decimal"
          autocomplete="off"
          placeholder="Ex.: 3"
          formControlName="target_roas"
          [error]="errorFor('target_roas')"
        />
        <p class="m-0 text-footnote text-fg-muted">Deixe em branco o que não se aplica.</p>
        <div class="actions">
          <button ds-button size="sm" type="submit" [loading]="saving()" [disabled]="saving()">Salvar metas</button>
          <button ds-button size="sm" variant="secondary" type="button" [disabled]="saving()" (click)="cancel()">
            Cancelar
          </button>
        </div>
      </form>
    } @else if (hasAny()) {
      <dl class="values">
        <div><dt>Margem bruta</dt><dd>{{ show(goals()?.gross_margin_pct, 'pct') }}</dd></div>
        <div><dt>Meta de CPA</dt><dd>{{ show(goals()?.target_cpa, 'currency') }}</dd></div>
        <div><dt>Meta de ROAS</dt><dd>{{ show(goals()?.target_roas, 'decimal') }}</dd></div>
      </dl>
      @if (savedExplanation(); as text) {
        <p class="effect m-0 text-footnote">{{ text }}</p>
      }
    } @else {
      <div class="empty">
        <svg lucideTarget [size]="24" class="text-fg-subtle"></svg>
        <p class="m-0 text-footnote text-fg-muted">
          Sem metas definidas.
          {{ canEdit() ? 'Informe a margem e as metas para alertas mais precisos.' : '' }}
        </p>
      </div>
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
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-2);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .effect {
      padding: var(--ds-space-2) var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-accent-soft);
      color: var(--ds-text);
    }
    .values {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin: 0;
    }
    .values div {
      display: flex;
      justify-content: space-between;
      gap: var(--ds-space-2);
      font: var(--ds-text-footnote);
    }
    .values dt {
      color: var(--ds-text-secondary);
    }
    .values dd {
      margin: 0;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .empty {
      display: flex;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .actions {
      display: flex;
      gap: var(--ds-space-2);
    }
  `,
})
export class ProjectGoalsPanel {
  readonly goals = input<ProjectGoals | null | undefined>(null);
  readonly canEdit = input(false);
  readonly saving = input(false);
  /** Erros do 422 com as chaves do Laravel ("goals.gross_margin_pct"). */
  readonly serverErrors = input<Record<string, string>>({});
  /** A tela fecha a edição quando o PATCH dá certo. */
  readonly editing = model(false);

  readonly save = output<UpdateProjectBody>();

  protected readonly form = new FormGroup({
    gross_margin_pct: new FormControl('', { nonNullable: true }),
    target_cpa: new FormControl('', { nonNullable: true }),
    target_roas: new FormControl('', { nonNullable: true }),
  });

  private readonly clientErrors = signal<Record<string, string>>({});
  private readonly margin = toSignal(this.form.controls.gross_margin_pct.valueChanges, { initialValue: '' });

  /** Efeito da margem calculado ao vivo enquanto digita. */
  protected readonly explanation = computed(() => {
    const value = parseDecimal(this.margin());
    return value === null || Number.isNaN(value) ? null : breakEvenExplanation(value);
  });
  protected readonly savedExplanation = computed(() => breakEvenExplanation(this.goals()?.gross_margin_pct ?? null));
  protected readonly hasAny = computed(() => {
    const g = this.goals();
    return !!g && (g.gross_margin_pct !== null || g.target_cpa !== null || g.target_roas !== null);
  });

  constructor() {
    // Cliente nunca fica em modo de edição, mesmo que a tela peça.
    effect(() => {
      if (this.editing() && !this.canEdit()) this.editing.set(false);
    });
  }

  protected startEditing(): void {
    this.form.setValue(goalsToForm(this.goals()));
    this.clientErrors.set({});
    this.editing.set(true);
  }

  protected cancel(): void {
    this.clientErrors.set({});
    this.editing.set(false);
  }

  protected errorFor(field: keyof GoalsForm): string | null {
    const key = `goals.${field}`;
    return this.clientErrors()[key] ?? this.serverErrors()[key] ?? null;
  }

  protected submit(): void {
    const values = this.form.getRawValue();
    const errors = validateGoals(values);
    this.clientErrors.set(errors);
    if (Object.keys(errors).length === 0) {
      this.save.emit(buildGoalsBody(values));
    }
  }

  protected show(value: number | null | undefined, kind: 'pct' | 'currency' | 'decimal'): string {
    if (value === null || value === undefined) return '—';
    if (kind === 'currency') return currency.format(value);
    return kind === 'pct' ? `${decimal.format(value)}%` : decimal.format(value);
  }
}
