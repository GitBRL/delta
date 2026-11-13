import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { LucideX } from '@lucide/angular';
import { MetricOption, groupOptions } from '../../core/reports/report-metrics';

let nextId = 0;

/**
 * Escolha de métricas para um bloco: busca, grupos por canal (os do projeto primeiro) e a lista
 * escolhida com ordem e limite. `single` = uma métrica só (gráfico).
 */
@Component({
  selector: 'app-metric-picker',
  imports: [LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!single()) {
      <div class="chosen-head">
        <span class="label">Métricas escolhidas</span>
        <span class="count" [class.full]="selected().length >= max()">{{ selected().length }}/{{ max() }}</span>
      </div>
      @if (selected().length === 0) {
        <p class="hint">Nenhuma ainda: marque abaixo.</p>
      } @else {
        <ol class="chosen" aria-label="Métricas escolhidas, em ordem">
          @for (key of selected(); track key; let first = $first, last = $last) {
            <li class="chosen-item" [attr.data-key]="key">
              <span class="name">
                {{ labelOf(key) }}
                <small>{{ groupOf(key) }}</small>
              </span>
              <button type="button" class="icon" [disabled]="first" (click)="move(key, -1)" [attr.aria-label]="'Subir ' + labelOf(key)">
                <span aria-hidden="true">↑</span>
              </button>
              <button type="button" class="icon" [disabled]="last" (click)="move(key, 1)" [attr.aria-label]="'Descer ' + labelOf(key)">
                <span aria-hidden="true">↓</span>
              </button>
              <button type="button" class="icon" (click)="toggle(key)" [attr.aria-label]="'Remover ' + labelOf(key)">
                <svg lucideX [size]="14"></svg>
              </button>
            </li>
          }
        </ol>
      }
    }

    <label class="search">
      <span class="ds-visually-hidden">Buscar métrica</span>
      <input
        type="search"
        placeholder="Buscar métrica ou canal…"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />
    </label>

    <div class="groups" role="group" [attr.aria-label]="single() ? 'Métrica do gráfico' : 'Métricas disponíveis'">
      @for (group of groups(); track group.name) {
        <fieldset class="group">
          <legend>
            {{ group.name }}
            @if (!group.linked) {
              <span class="unlinked">sem conta no projeto</span>
            }
          </legend>
          @for (o of group.options; track o.key) {
            <label class="option" [title]="o.description">
              <input
                [type]="single() ? 'radio' : 'checkbox'"
                [name]="name"
                [value]="o.key"
                [checked]="isSelected(o.key)"
                [disabled]="!single() && !isSelected(o.key) && selected().length >= max()"
                (change)="toggle(o.key)"
              />
              <span>{{ o.label }}</span>
            </label>
          }
        </fieldset>
      } @empty {
        <p class="hint">Nenhuma métrica encontrada para “{{ query() }}”.</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .chosen-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .label {
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .count {
      font: var(--ds-text-caption);
      font-weight: 700;
      color: var(--ds-text-secondary);
    }
    .count.full {
      color: var(--ds-status-attention);
    }
    .hint {
      margin: 0;
      font: var(--ds-text-footnote);
      color: var(--ds-text-tertiary);
    }
    .chosen {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .chosen-item {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 4px 4px 4px 10px;
      border-radius: var(--ds-radius-sm);
      background: var(--ds-fill);
      animation: ds-fade-up var(--ds-duration-base) var(--ds-ease-spring-gentle) both;
    }
    .name {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      font: var(--ds-text-footnote);
      font-weight: 600;
    }
    .name small {
      font: var(--ds-text-caption);
      font-weight: 400;
      color: var(--ds-text-tertiary);
    }
    .icon {
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border: 0;
      border-radius: var(--ds-radius-sm);
      background: transparent;
      color: var(--ds-text-secondary);
      cursor: pointer;
    }
    .icon:hover:not(:disabled) {
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
    }
    .icon:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .search input {
      width: 100%;
      height: 34px;
      padding: 0 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
    }
    .groups {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      max-height: 340px;
      overflow: auto;
      padding-right: 4px;
    }
    .group {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 0;
      padding: 0;
      border: 0;
    }
    legend {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 4px;
      padding: 0;
      font: var(--ds-text-caption);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--ds-text-secondary);
    }
    .unlinked {
      font-weight: 500;
      letter-spacing: 0;
      text-transform: none;
      color: var(--ds-text-tertiary);
    }
    .option {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      border-radius: var(--ds-radius-sm);
      font: var(--ds-text-footnote);
      cursor: pointer;
    }
    .option:hover {
      background: var(--ds-fill);
    }
    .option input:disabled + span {
      opacity: 0.45;
    }
  `,
})
export class MetricPicker {
  readonly options = input.required<readonly MetricOption[]>();
  readonly selected = model<string[]>([]);
  readonly max = input(12);
  readonly single = input(false);

  protected readonly name = `metric-picker-${nextId++}`;
  protected readonly query = signal('');
  protected readonly groups = computed(() => groupOptions(this.options(), this.query()));
  private readonly byKey = computed(() => new Map(this.options().map((o) => [o.key, o])));

  protected labelOf(key: string): string {
    return this.byKey().get(key)?.label ?? key;
  }

  protected groupOf(key: string): string {
    return this.byKey().get(key)?.group ?? '';
  }

  protected isSelected(key: string): boolean {
    return this.selected().includes(key);
  }

  protected toggle(key: string): void {
    if (this.single()) {
      this.selected.set([key]);
      return;
    }
    const current = this.selected();
    if (current.includes(key)) {
      this.selected.set(current.filter((k) => k !== key));
    } else if (current.length < this.max()) {
      this.selected.set([...current, key]);
    }
  }

  protected move(key: string, delta: -1 | 1): void {
    const list = [...this.selected()];
    const index = list.indexOf(key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    this.selected.set(list);
  }
}
