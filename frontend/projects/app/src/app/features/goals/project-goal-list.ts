import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DsButton, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ApiEnvelope,
  CustomMetric,
  Goal,
  GoalBody,
  GoalComparison,
  GoalPeriod,
  ManualMetric,
  MetricDefinition,
  MetricDirection,
  MetricUnit,
  Provider,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors } from '../../core/forms/server-errors';
import { groupOptions, metricOptions } from '../../core/reports/report-metrics';
import { TenantService } from '../../core/tenant/tenant.service';
import { GoalCard } from './goal-card';
import { parseTarget } from './goals';

interface GoalDraft {
  id: string | null;
  metric_key: string;
  comparison: GoalComparison;
  target: string;
  period: GoalPeriod;
}

const EMPTY: GoalDraft = { id: null, metric_key: '', comparison: 'at_least', target: '', period: 'month' };

const UNIT_HINT: Partial<Record<MetricUnit, string>> = { currency: 'R$', percent: '%', duration: 'segundos' };

/** Valor do alvo como o usuário digita ("1.234,5"). */
function targetText(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6, useGrouping: false }).format(value);
}

/**
 * Metas do projeto: lista com progresso e, para a equipe, criar/editar/remover.
 * Métrica: catálogo + indicadores personalizados + dados manuais. A sugestão de "pelo menos" ou
 * "no máximo" segue a direção da métrica (CPA: no máximo; leads: pelo menos).
 */
@Component({
  selector: 'app-project-goal-list',
  imports: [DsButton, DsSkeleton, GoalCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="pgoals-title">
      <div class="head">
        <h2 id="pgoals-title" class="m-0 text-headline">Metas</h2>
        @if (canEdit() && !draft()) {
          <button ds-button variant="secondary" size="sm" (click)="open()">Nova meta</button>
        }
      </div>
      <p class="m-0 mb-3 text-footnote text-fg-muted">Ex.: "200 leads no mês", "CPA até R$ 50", "ROAS de pelo menos 3".</p>

      @if (draft(); as d) {
        <form class="form" aria-label="Meta" (submit)="$event.preventDefault(); save()">
          <label class="field">
            <span>Métrica</span>
            <select name="goal_metric" (change)="pickMetric($any($event.target).value)" [attr.aria-invalid]="!!errors()['metric_key']">
              <option value="" [selected]="!d.metric_key">Escolha a métrica…</option>
              @for (group of optionGroups(); track group.name) {
                <optgroup [label]="group.name">
                  @for (o of group.options; track o.key) {
                    <option [value]="o.key" [selected]="o.key === d.metric_key">{{ o.label }}</option>
                  }
                </optgroup>
              }
            </select>
            @if (errors()['metric_key']) {
              <small class="error" role="alert">{{ errors()['metric_key'] }}</small>
            }
          </label>

          <fieldset class="seg" aria-label="Tipo de meta">
            <label [class.on]="d.comparison === 'at_least'">
              <input type="radio" name="goal_comparison" value="at_least" [checked]="d.comparison === 'at_least'" (change)="patch({ comparison: 'at_least' })" />
              Pelo menos
            </label>
            <label [class.on]="d.comparison === 'at_most'">
              <input type="radio" name="goal_comparison" value="at_most" [checked]="d.comparison === 'at_most'" (change)="patch({ comparison: 'at_most' })" />
              No máximo
            </label>
          </fieldset>

          <div class="row">
            <label class="field grow">
              <span>Alvo{{ unitHint() ? ' (' + unitHint() + ')' : '' }}</span>
              <input
                type="text"
                inputmode="decimal"
                name="goal_target"
                placeholder="Ex.: 200"
                [value]="d.target"
                (input)="patch({ target: $any($event.target).value })"
                [attr.aria-invalid]="!!errors()['target']"
              />
              @if (errors()['target']) {
                <small class="error" role="alert">{{ errors()['target'] }}</small>
              }
            </label>
            <label class="field">
              <span>Período</span>
              <select name="goal_period" (change)="patch({ period: $any($event.target).value })">
                <option value="month" [selected]="d.period === 'month'">Por mês</option>
                <option value="week" [selected]="d.period === 'week'">Por semana</option>
              </select>
            </label>
          </div>

          <div class="actions">
            <button ds-button type="submit" size="sm" [loading]="saving()">{{ d.id ? 'Salvar meta' : 'Criar meta' }}</button>
            <button ds-button type="button" variant="ghost" size="sm" (click)="draft.set(null)">Cancelar</button>
          </div>
        </form>
      }

      @if (goals.isLoading() && !goals.hasValue()) {
        <ds-skeleton height="96px" radius="var(--ds-radius-lg)" />
      } @else if (list().length === 0 && !draft()) {
        <p class="m-0 text-footnote text-fg-muted">Nenhuma meta para este projeto.</p>
      } @else {
        <ul class="list">
          @for (goal of list(); track goal.id) {
            <li [attr.data-goal]="goal.id">
              <app-goal-card [goal]="goal" />
              @if (canEdit()) {
                <div class="item-actions">
                  @if (confirming() === goal.id) {
                    <span class="text-footnote">Remover esta meta?</span>
                    <button ds-button variant="ghost" size="sm" [loading]="removing() === goal.id" (click)="remove(goal)">Remover</button>
                    <button ds-button variant="ghost" size="sm" (click)="confirming.set(null)">Manter</button>
                  } @else {
                    <button ds-button variant="ghost" size="sm" (click)="edit(goal)">Editar</button>
                    <button ds-button variant="ghost" size="sm" (click)="confirming.set(goal.id)">Remover</button>
                  }
                </div>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-2);
      margin-bottom: 4px;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      margin-bottom: var(--ds-space-4);
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
    .field select,
    .field input {
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
    }
    .row {
      display: flex;
      gap: var(--ds-space-3);
    }
    .grow {
      flex: 1;
    }
    .seg {
      display: inline-flex;
      gap: 4px;
      margin: 0;
      padding: 3px;
      border: 0;
      border-radius: var(--ds-radius-md);
      background: var(--ds-bg-elevated);
    }
    .seg label {
      padding: 4px 12px;
      border-radius: var(--ds-radius-sm);
      font: var(--ds-text-footnote);
      cursor: pointer;
    }
    .seg label.on {
      background: var(--ds-accent);
      color: white;
    }
    .seg input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .seg label:focus-within {
      outline: 2px solid var(--ds-accent);
      outline-offset: 2px;
    }
    .error {
      color: var(--ds-status-critical);
      font-weight: 500;
    }
    .actions,
    .item-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .item-actions {
      justify-content: flex-end;
      margin-top: 4px;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
  `,
})
export class ProjectGoalList {
  readonly projectId = input.required<string>();
  readonly canEdit = input(false);
  /** Canais com conta no projeto (aparecem primeiro no seletor). */
  readonly linkedProviders = input<readonly string[]>([]);

  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  private readonly tenant = inject(TenantService);

  private readonly request = (url: string) => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  };

  readonly goals = httpResource<ApiEnvelope<Goal[]>>(() => this.request(API.projectGoals(this.projectId())));
  protected readonly list = computed(() => (this.goals.hasValue() ? this.goals.value().data : []));

  readonly draft = signal<GoalDraft | null>(null);
  readonly errors = signal<FieldErrors>({});
  readonly saving = signal(false);
  readonly confirming = signal<string | null>(null);
  readonly removing = signal<string | null>(null);

  /* Opções de métrica: só carregam quando o formulário abre. */
  private readonly formOpen = computed(() => this.draft() !== null);
  protected readonly catalog = httpResource<ApiEnvelope<MetricDefinition[]>>(() => (this.formOpen() ? API.metricsCatalog : undefined));
  protected readonly providers = httpResource<ApiEnvelope<Provider[]>>(() => (this.formOpen() ? this.request(API.providers) : undefined));
  protected readonly customs = httpResource<ApiEnvelope<CustomMetric[]>>(() => (this.formOpen() ? this.request(API.customMetrics) : undefined));
  protected readonly manuals = httpResource<ApiEnvelope<ManualMetric[]>>(() => (this.formOpen() ? this.request(API.manualMetrics) : undefined));

  private readonly catalogList = computed(() => (this.catalog.hasValue() ? this.catalog.value().data : []));
  private readonly customList = computed(() => (this.customs.hasValue() ? this.customs.value().data : []));
  private readonly manualList = computed(() => (this.manuals.hasValue() ? this.manuals.value().data : []));

  protected readonly optionGroups = computed(() =>
    groupOptions(
      metricOptions(
        this.catalogList(),
        this.providers.hasValue() ? this.providers.value().data : [],
        this.customList(),
        this.linkedProviders(),
        this.manualList(),
      ),
    ),
  );

  /** Direção e unidade por chave (sugestão de comparação e dica do alvo). */
  private readonly metricInfo = computed(() => {
    const map = new Map<string, { direction: MetricDirection; unit: MetricUnit }>();
    for (const m of this.catalogList()) map.set(m.key, { direction: m.direction, unit: m.unit });
    for (const m of this.customList()) map.set(m.key, { direction: m.direction, unit: m.unit });
    for (const m of this.manualList()) map.set(m.key, { direction: m.direction, unit: m.unit });
    return map;
  });

  protected readonly unitHint = computed(() => {
    const key = this.draft()?.metric_key;
    const unit = key ? this.metricInfo().get(key)?.unit : undefined;
    return unit ? (UNIT_HINT[unit] ?? '') : '';
  });

  open(): void {
    this.errors.set({});
    this.draft.set({ ...EMPTY });
  }

  edit(goal: Goal): void {
    this.errors.set({});
    this.draft.set({
      id: goal.id,
      metric_key: goal.metric_key,
      comparison: goal.comparison,
      target: targetText(goal.target),
      period: goal.period,
    });
  }

  protected patch(change: Partial<GoalDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
    const field = Object.keys(change)[0];
    if (field && this.errors()[field]) {
      this.errors.update((all) => {
        const next = { ...all };
        delete next[field];
        return next;
      });
    }
  }

  /** Escolher a métrica sugere a comparação pela direção (só na criação). */
  pickMetric(key: string): void {
    const direction = this.metricInfo().get(key)?.direction;
    const isNew = !this.draft()?.id;
    this.patch({ metric_key: key, ...(isNew && direction ? { comparison: direction === 'lower_is_better' ? 'at_most' : 'at_least' } : {}) });
  }

  async save(): Promise<void> {
    const tenantId = this.tenant.currentId();
    const d = this.draft();
    if (!tenantId || !d || this.saving()) return;

    const errors: FieldErrors = {};
    if (!d.metric_key) errors['metric_key'] = 'Escolha a métrica.';
    const target = parseTarget(d.target);
    if (target === null) errors['target'] = 'Informe um alvo maior que zero.';
    if (Object.keys(errors).length || target === null) {
      this.errors.set(errors);
      return;
    }

    const body: GoalBody = { metric_key: d.metric_key, comparison: d.comparison, target, period: d.period };
    const headers = { [TENANT_HEADER]: tenantId };
    this.saving.set(true);
    try {
      if (d.id) {
        await firstValueFrom(this.http.put<ApiEnvelope<Goal>>(API.goal(d.id), body, { headers }));
      } else {
        await firstValueFrom(this.http.post<ApiEnvelope<Goal>>(API.projectGoals(this.projectId()), body, { headers }));
      }
      this.toast.success(d.id ? 'Meta atualizada' : 'Meta criada');
      this.draft.set(null);
      this.goals.reload();
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) this.errors.set(fields);
      else if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
        this.toast.error('Não foi possível salvar a meta');
      }
    } finally {
      this.saving.set(false);
    }
  }

  async remove(goal: Goal): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId) return;
    this.removing.set(goal.id);
    try {
      await firstValueFrom(this.http.delete(API.goal(goal.id), { headers: { [TENANT_HEADER]: tenantId } }));
      this.toast.success('Meta removida');
      this.confirming.set(null);
      this.goals.reload();
    } catch {
      /* 403/5xx: toast no interceptor */
    } finally {
      this.removing.set(null);
    }
  }
}
