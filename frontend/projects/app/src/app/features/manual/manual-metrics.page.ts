import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsButton, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, ManualMetric, ManualMetricBody, TENANT_HEADER } from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors } from '../../core/forms/server-errors';
import { TenantService } from '../../core/tenant/tenant.service';
import { AGGREGATION_OPTIONS, DIRECTION_OPTIONS, EMPTY_MANUAL, UNIT_OPTIONS } from './manual';

/**
 * Dados manuais: métricas que não vêm de plataforma (vendas da loja, leads do CRM, receita do
 * caixa). Aqui ficam as definições; os valores são lançados na página de cada projeto.
 * Rota: /dados-manuais (equipe).
 */
@Component({
  selector: 'app-manual-metrics-page',
  imports: [RouterLink, DsButton, DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-6">
      <p class="m-0 text-footnote font-semibold uppercase tracking-wider text-fg-subtle">{{ tenant.current()?.name }}</p>
      <h1 class="m-0 mt-1 text-large-title font-bold tracking-tight">Dados manuais</h1>
      <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
        Números que não vêm de nenhuma plataforma — vendas da loja física, leads do CRM, receita do
        caixa. Defina a métrica aqui e lance os valores na página de cada projeto (digitando ou
        colando a planilha). Elas valem em relatórios, metas e indicadores personalizados, como um
        "ROAS real" = vendas da loja ÷ investimento em anúncios.
      </p>
    </header>

    @if (!canEdit()) {
      <div class="state ds-glass">
        <p class="m-0 text-headline">Só a equipe da agência define os dados manuais.</p>
      </div>
    } @else {
      <div class="layout">
        <section class="defs" aria-labelledby="defs-title">
          <div class="head">
            <h2 id="defs-title" class="m-0 text-title-3 font-semibold">Métricas</h2>
            @if (!editing()) {
              <button ds-button size="sm" (click)="open(null)">Nova métrica</button>
            }
          </div>

          @if (metrics.isLoading() && !metrics.hasValue()) {
            <ds-skeleton height="64px" radius="var(--ds-radius-md)" />
          } @else if (list().length === 0) {
            <div class="empty ds-glass">
              <p class="m-0 text-headline">Nenhuma métrica manual ainda</p>
              <p class="m-0 text-footnote text-fg-muted">Comece por "Vendas na loja" ou "Leads do CRM".</p>
            </div>
          } @else {
            <ul class="list">
              @for (m of list(); track m.id) {
                <li class="item ds-glass" [attr.data-metric]="m.id">
                  <div class="min-w-0">
                    <p class="m-0 text-subhead font-semibold">{{ m.name }}</p>
                    <p class="m-0 text-caption text-fg-muted">
                      <code>{{ m.key }}</code> · {{ unitLabel(m.unit) }} · {{ m.aggregation === 'sum' ? 'soma os dias' : 'último valor' }}
                    </p>
                    @if (m.description) {
                      <p class="m-0 text-footnote text-fg-muted">{{ m.description }}</p>
                    }
                    @if (rowErrors()[m.id]; as err) {
                      <p class="error" role="alert">{{ err }}</p>
                    }
                  </div>
                  <div class="actions">
                    @if (confirming() === m.id) {
                      <button ds-button variant="ghost" size="sm" [loading]="removing() === m.id" (click)="remove(m)">Excluir</button>
                      <button ds-button variant="ghost" size="sm" (click)="confirming.set(null)">Manter</button>
                    } @else {
                      <button ds-button variant="ghost" size="sm" (click)="open(m)">Editar</button>
                      <button ds-button variant="ghost" size="sm" (click)="confirming.set(m.id)">Excluir</button>
                    }
                  </div>
                </li>
              }
            </ul>
          }
          <p class="m-0 mt-4 text-footnote text-fg-muted">
            Para lançar valores, abra um <a routerLink="/projetos">projeto</a> e use a seção "Dados manuais".
          </p>
        </section>

        @if (editing(); as d) {
          <form class="form ds-glass" aria-label="Métrica manual" (submit)="$event.preventDefault(); save()">
            <h2 class="m-0 text-title-3 font-semibold">{{ editingId() ? 'Editar métrica' : 'Nova métrica' }}</h2>
            <label class="field">
              <span>Nome</span>
              <input type="text" name="manual_name" maxlength="80" placeholder="Ex.: Vendas na loja" [value]="d.name" (input)="patch({ name: $any($event.target).value })" />
              @if (errors()['name']) {
                <small class="error" role="alert">{{ errors()['name'] }}</small>
              }
            </label>
            <label class="field">
              <span>Descrição (opcional)</span>
              <input type="text" name="manual_description" maxlength="300" [value]="d.description ?? ''" (input)="patch({ description: $any($event.target).value })" />
            </label>
            <div class="row">
              <label class="field grow">
                <span>Unidade</span>
                <select name="manual_unit" (change)="patch({ unit: $any($event.target).value })">
                  @for (o of unitOptions; track o.value) {
                    <option [value]="o.value" [selected]="o.value === d.unit">{{ o.label }}</option>
                  }
                </select>
              </label>
              <label class="field">
                <span>Casas decimais</span>
                <input type="number" name="manual_decimals" min="0" max="6" [value]="d.decimals" (input)="patch({ decimals: +$any($event.target).value })" />
              </label>
            </div>
            <label class="field">
              <span>Direção</span>
              <select name="manual_direction" (change)="patch({ direction: $any($event.target).value })">
                @for (o of directionOptions; track o.value) {
                  <option [value]="o.value" [selected]="o.value === d.direction">{{ o.label }}</option>
                }
              </select>
            </label>
            <fieldset class="agg">
              <legend>Como o período soma os lançamentos</legend>
              @for (o of aggregationOptions; track o.value) {
                <label class="agg-option" [class.on]="d.aggregation === o.value">
                  <input type="radio" name="manual_aggregation" [value]="o.value" [checked]="d.aggregation === o.value" (change)="patch({ aggregation: o.value })" />
                  <span>
                    <strong>{{ o.label }}</strong>
                    <small>{{ o.help }}</small>
                  </span>
                </label>
              }
              @if (errors()['aggregation']) {
                <small class="error" role="alert">{{ errors()['aggregation'] }}</small>
              }
            </fieldset>
            <div class="actions">
              <button ds-button type="submit" [loading]="saving()">{{ editingId() ? 'Salvar' : 'Criar métrica' }}</button>
              <button ds-button type="button" variant="ghost" (click)="editing.set(null)">Cancelar</button>
            </div>
          </form>
        }
      </div>
    }
  `,
  styles: `
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 420px);
      align-items: start;
      gap: var(--ds-space-6);
    }
    @media (max-width: 960px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--ds-space-3);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-3);
      padding: var(--ds-space-3) var(--ds-space-4);
      border-radius: var(--ds-radius-lg);
    }
    code {
      font-family: var(--ds-font-mono);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-2);
    }
    .empty,
    .state {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      padding: var(--ds-space-6);
      border-radius: var(--ds-radius-xl);
      text-align: center;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      padding: var(--ds-space-5);
      border-radius: var(--ds-radius-xl);
    }
    .row {
      display: flex;
      gap: var(--ds-space-3);
    }
    .grow {
      flex: 1;
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
    .agg {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .agg legend {
      margin-bottom: 4px;
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .agg-option {
      display: flex;
      gap: var(--ds-space-2);
      padding: var(--ds-space-2) var(--ds-space-3);
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      cursor: pointer;
    }
    .agg-option.on {
      border-color: var(--ds-accent);
      background: var(--ds-accent-soft, var(--ds-fill));
    }
    .agg-option span {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font: var(--ds-text-footnote);
    }
    .agg-option small {
      color: var(--ds-text-secondary);
    }
    .error {
      margin: 0;
      font: var(--ds-text-caption);
      color: var(--ds-status-critical);
      font-weight: 500;
    }
  `,
})
export class ManualMetricsPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);

  protected readonly unitOptions = UNIT_OPTIONS;
  protected readonly directionOptions = DIRECTION_OPTIONS;
  protected readonly aggregationOptions = AGGREGATION_OPTIONS;

  protected readonly canEdit = computed(() => !!this.tenant.current() && this.tenant.current()?.role !== 'client');

  readonly metrics = httpResource<ApiEnvelope<ManualMetric[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId && this.canEdit() ? { url: API.manualMetrics, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });
  protected readonly list = computed(() => (this.metrics.hasValue() ? this.metrics.value().data : []));

  readonly editing = signal<ManualMetricBody | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly errors = signal<FieldErrors>({});
  /** Erro por métrica (ex.: excluir uma usada por indicador). */
  readonly rowErrors = signal<Readonly<Record<string, string>>>({});
  readonly saving = signal(false);
  readonly confirming = signal<string | null>(null);
  readonly removing = signal<string | null>(null);

  protected unitLabel(unit: string): string {
    return UNIT_OPTIONS.find((o) => o.value === unit)?.label.split(' (')[0] ?? unit;
  }

  open(metric: ManualMetric | null): void {
    this.errors.set({});
    this.editingId.set(metric?.id ?? null);
    this.editing.set(
      metric
        ? {
            name: metric.name,
            description: metric.description,
            unit: metric.unit,
            direction: metric.direction,
            decimals: metric.decimals,
            aggregation: metric.aggregation,
          }
        : { ...EMPTY_MANUAL },
    );
  }

  protected patch(change: Partial<ManualMetricBody>): void {
    this.editing.update((d) => (d ? { ...d, ...change } : d));
  }

  async save(): Promise<void> {
    const tenantId = this.tenant.currentId();
    const draft = this.editing();
    if (!tenantId || !draft || this.saving()) return;
    if (draft.name.trim().length < 2) {
      this.errors.set({ name: 'Dê um nome à métrica.' });
      return;
    }

    const body: ManualMetricBody = {
      ...draft,
      name: draft.name.trim(),
      description: draft.description?.trim() || null,
      decimals: Math.min(6, Math.max(0, Math.round(draft.decimals || 0))),
    };
    const id = this.editingId();
    const headers = { [TENANT_HEADER]: tenantId };
    this.saving.set(true);
    try {
      if (id) await firstValueFrom(this.http.put(API.manualMetric(id), body, { headers }));
      else await firstValueFrom(this.http.post(API.manualMetrics, body, { headers }));
      this.toast.success(id ? 'Métrica atualizada' : 'Métrica criada', {
        message: id ? undefined : 'Lance os valores na página de cada projeto.',
      });
      this.editing.set(null);
      this.metrics.reload();
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) this.errors.set(fields);
      else if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
        this.toast.error('Não foi possível salvar a métrica');
      }
    } finally {
      this.saving.set(false);
    }
  }

  async remove(metric: ManualMetric): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId) return;
    this.removing.set(metric.id);
    try {
      await firstValueFrom(this.http.delete(API.manualMetric(metric.id), { headers: { [TENANT_HEADER]: tenantId } }));
      this.toast.success('Métrica excluída');
      this.confirming.set(null);
      this.metrics.reload();
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) {
        this.rowErrors.update((all) => ({ ...all, [metric.id]: fields['metric'] ?? Object.values(fields)[0] ?? 'Não foi possível excluir.' }));
        this.confirming.set(null);
      }
    } finally {
      this.removing.set(null);
    }
  }
}
