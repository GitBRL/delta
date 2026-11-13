import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { DsButton } from 'design-system';
import {
  API,
  ActionBody,
  ApiEnvelope,
  CustomMetric,
  ManualMetric,
  MetricDefinition,
  PlanAction,
  Provider,
  StaffMember,
} from '../../core/api/api.types';
import { FieldErrors } from '../../core/forms/server-errors';
import { groupOptions, metricOptions } from '../../core/reports/report-metrics';
import { ActionsApi, metricName } from './actions';

interface Draft {
  title: string;
  metric_key: string;
  suggestion: string;
  assignee_id: string;
  due_on: string;
}

/**
 * Criar ou editar uma ação do plano. Vinda de um sinal do semáforo, chega pré-preenchida
 * (regra, métrica, título e sugestão); sem sinal, a métrica é escolhida na lista da agência.
 */
@Component({
  selector: 'app-action-form',
  imports: [DsButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="form" [attr.aria-label]="action() ? 'Editar ação' : 'Nova ação'" (submit)="$event.preventDefault(); save()" animate.enter="ds-enter-fade-up">
      <label class="field">
        <span>O que fazer</span>
        <input name="action_title" type="text" maxlength="160" [value]="draft().title" (input)="patch({ title: $any($event.target).value })" [attr.aria-invalid]="!!errors()['title']" />
        @if (errors()['title']) {
          <small class="error" role="alert">{{ errors()['title'] }}</small>
        }
      </label>

      @if (pickMetric()) {
        <label class="field">
          <span>Métrica que a ação quer mexer</span>
          <select name="action_metric" (change)="patch({ metric_key: $any($event.target).value })" [attr.aria-invalid]="!!errors()['metric_key']">
            <option value="" [selected]="!draft().metric_key">Escolha a métrica…</option>
            @for (group of optionGroups(); track group.name) {
              <optgroup [label]="group.name">
                @for (o of group.options; track o.key) {
                  <option [value]="o.key" [selected]="o.key === draft().metric_key">{{ o.label }}</option>
                }
              </optgroup>
            }
          </select>
          @if (errors()['metric_key']) {
            <small class="error" role="alert">{{ errors()['metric_key'] }}</small>
          }
        </label>
      } @else {
        <p class="m-0 text-footnote text-fg-muted">Métrica medida: <strong>{{ metricLabel() }}</strong></p>
      }

      @if (!action()) {
        <label class="field">
          <span>Detalhes (opcional)</span>
          <textarea name="action_suggestion" rows="3" maxlength="1000" [value]="draft().suggestion" (input)="patch({ suggestion: $any($event.target).value })"></textarea>
        </label>
      }

      <div class="row">
        <label class="field grow">
          <span>Responsável</span>
          <select name="action_assignee" (change)="patch({ assignee_id: $any($event.target).value })" [attr.aria-invalid]="!!errors()['assignee_id']">
            <option value="" [selected]="!draft().assignee_id">Ninguém ainda</option>
            @for (m of staff(); track m.id) {
              <option [value]="m.id" [selected]="m.id === draft().assignee_id">{{ m.name }}</option>
            }
          </select>
          @if (errors()['assignee_id']) {
            <small class="error" role="alert">{{ errors()['assignee_id'] }}</small>
          }
        </label>
        <label class="field">
          <span>Prazo</span>
          <input name="action_due" type="date" [value]="draft().due_on" (input)="patch({ due_on: $any($event.target).value })" />
        </label>
      </div>

      <div class="actions">
        <button ds-button type="submit" size="sm" [loading]="saving()">{{ action() ? 'Salvar ação' : 'Criar ação' }}</button>
        <button ds-button type="button" variant="ghost" size="sm" (click)="cancelled.emit()">Cancelar</button>
      </div>
    </form>
  `,
  styles: `
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
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
    .field select,
    .field textarea {
      min-height: 36px;
      padding: 6px 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
    }
    .field textarea {
      resize: vertical;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-3);
    }
    .grow {
      flex: 1;
      min-width: 160px;
    }
    .error {
      color: var(--ds-status-critical);
      font-weight: 500;
    }
    .actions {
      display: flex;
      gap: var(--ds-space-2);
    }
  `,
})
export class ActionForm {
  /** Projeto (obrigatório para criar). */
  readonly projectId = input<string | null>(null);
  /** Pré-preenchimento (ex.: a partir de um sinal do semáforo). */
  readonly seed = input<ActionBody | null>(null);
  /** Ação em edição. */
  readonly action = input<PlanAction | null>(null);
  readonly labels = input<Readonly<Record<string, string>>>({});
  readonly linkedProviders = input<readonly string[]>([]);

  readonly saved = output<PlanAction>();
  readonly cancelled = output<void>();

  private readonly api = inject(ActionsApi);

  readonly draft = linkedSignal<Draft>(() => {
    const a = this.action();
    const s = this.seed();
    return {
      title: a?.title ?? s?.title ?? '',
      metric_key: a?.metric_key ?? s?.metric_key ?? '',
      suggestion: a?.suggestion ?? s?.suggestion ?? '',
      assignee_id: a?.assignee?.id ?? s?.assignee_id ?? '',
      due_on: a?.due_on ?? s?.due_on ?? '',
    };
  });
  readonly errors = signal<FieldErrors>({});
  readonly saving = signal(false);

  /** Escolha de métrica só ao criar sem sinal (a métrica de uma ação não muda depois). */
  protected readonly pickMetric = computed(() => !this.action() && !this.seed()?.metric_key);
  protected readonly metricLabel = computed(() => metricName(this.draft().metric_key, this.labels()));

  protected readonly staffMembers = httpResource<ApiEnvelope<StaffMember[]>>(() => API.staffMembers);
  protected readonly staff = computed(() => (this.staffMembers.hasValue() ? this.staffMembers.value().data : []));

  protected readonly catalog = httpResource<ApiEnvelope<MetricDefinition[]>>(() => (this.pickMetric() ? API.metricsCatalog : undefined));
  protected readonly providers = httpResource<ApiEnvelope<Provider[]>>(() => (this.pickMetric() ? API.providers : undefined));
  protected readonly customs = httpResource<ApiEnvelope<CustomMetric[]>>(() => (this.pickMetric() ? API.customMetrics : undefined));
  protected readonly manuals = httpResource<ApiEnvelope<ManualMetric[]>>(() => (this.pickMetric() ? API.manualMetrics : undefined));

  protected readonly optionGroups = computed(() =>
    groupOptions(
      metricOptions(
        this.catalog.hasValue() ? this.catalog.value().data : [],
        this.providers.hasValue() ? this.providers.value().data : [],
        this.customs.hasValue() ? this.customs.value().data : [],
        this.linkedProviders(),
        this.manuals.hasValue() ? this.manuals.value().data : [],
      ),
    ),
  );

  protected patch(change: Partial<Draft>): void {
    this.draft.update((d) => ({ ...d, ...change }));
    const field = Object.keys(change)[0];
    if (field && this.errors()[field]) {
      this.errors.update((all) => {
        const next = { ...all };
        delete next[field];
        return next;
      });
    }
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    const d = this.draft();
    const errors: FieldErrors = {};
    if (d.title.trim().length < 2) errors['title'] = 'Descreva a ação.';
    if (!d.metric_key) errors['metric_key'] = 'Escolha a métrica que a ação quer melhorar.';
    if (Object.keys(errors).length) {
      this.errors.set(errors);
      return;
    }

    this.saving.set(true);
    const common = {
      title: d.title.trim(),
      assignee_id: d.assignee_id || null,
      due_on: d.due_on || null,
    };
    const existing = this.action();
    const projectId = this.projectId();
    const result = existing
      ? await this.api.patch(existing.id, common)
      : projectId
        ? await this.api.create(projectId, {
            ...common,
            rule: this.seed()?.rule ?? null,
            metric_key: d.metric_key,
            suggestion: d.suggestion.trim() || null,
          })
        : null;
    this.saving.set(false);

    if (!result) return;
    if (result.ok) {
      this.saved.emit(result.data);
    } else if (result.fields) {
      this.errors.set(result.fields);
    }
  }
}
