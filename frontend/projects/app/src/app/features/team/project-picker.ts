import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { ProjectRef } from '../../core/api/api.types';

/** Escolha de projetos (para o papel cliente): chips que ligam e desligam. */
@Component({
  selector: 'app-project-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="picker" [attr.aria-invalid]="!!error()" [attr.aria-describedby]="error() ? errorId() : null">
      <legend class="legend">{{ label() }}</legend>
      @if (projects().length === 0) {
        <p class="empty">Nenhum projeto ainda. Crie um em Projetos para dar acesso a um cliente.</p>
      } @else {
        <div class="chips">
          @for (project of projects(); track project.id) {
            <label class="chip" [class.is-on]="isSelected(project.id)">
              <input
                type="checkbox"
                [name]="name() + '-' + project.id"
                [checked]="isSelected(project.id)"
                (change)="toggle(project.id)"
              />
              <span>{{ project.name }}</span>
            </label>
          }
        </div>
      }
      @if (error()) {
        <span class="error" [id]="errorId()" role="alert">{{ error() }}</span>
      }
    </fieldset>
  `,
  styles: `
    .picker {
      margin: 0;
      padding: 0;
      border: 0;
      min-width: 0;
    }

    .legend {
      padding: 0;
      margin-bottom: var(--ds-space-2);
      font: var(--ds-text-footnote);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .chip {
      position: relative;
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid var(--ds-separator);
      background: var(--ds-bg-elevated);
      color: var(--ds-text-secondary);
      font: var(--ds-text-footnote);
      font-weight: 600;
      cursor: pointer;
      transition:
        background var(--ds-duration-fast) var(--ds-ease-out),
        color var(--ds-duration-fast) var(--ds-ease-out),
        border-color var(--ds-duration-fast) var(--ds-ease-out);
    }

    .chip input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .chip.is-on {
      border-color: transparent;
      background: var(--ds-accent-soft);
      color: var(--ds-accent);
    }

    .chip:has(input:focus-visible) {
      outline: 2px solid var(--ds-accent);
      outline-offset: 2px;
    }

    .empty {
      margin: 0;
      font: var(--ds-text-footnote);
      color: var(--ds-text-tertiary);
    }

    .error {
      display: block;
      margin-top: 6px;
      font: var(--ds-text-footnote);
      color: var(--ds-status-critical);
    }
  `,
})
export class ProjectPicker {
  readonly projects = input.required<readonly ProjectRef[]>();
  readonly selected = model<readonly string[]>([]);
  readonly label = input('Projetos que o cliente vê');
  readonly name = input('projects');
  readonly error = input<string | null>(null);

  protected readonly errorId = () => `${this.name()}-error`;

  protected isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  protected toggle(id: string): void {
    const current = this.selected();
    this.selected.set(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }
}
