import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowLeft } from '@lucide/angular';
import { DsAreaChart, DsButton, DsGlassCard, DsKpiTile, DsSkeleton, DsTextField, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ApiEnvelope,
  CompareMode,
  CustomMetric,
  CustomMetricTemplate,
  DateRange,
  ManualMetric,
  MetricDefinition,
  MetricDirection,
  MetricUnit,
  Project,
  Provider,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors } from '../../core/forms/server-errors';
import {
  CustomMetricDraft,
  DIRECTION_OPTIONS,
  EMPTY_DRAFT,
  UNIT_OPTIONS,
  buildCustomMetricBody,
  buildPreviewBody,
  draftFrom,
  formulaOptions,
  referenceLabels,
} from '../../core/metrics/custom-metrics';
import { createFormulaPreview } from '../../core/metrics/formula-preview';
import { formatterFor, kpiDirection } from '../../core/metrics/metrics-query.service';
import { PeriodPreset, compareCaption, resolvePreset, validateRange } from '../../core/metrics/period';
import { TenantService } from '../../core/tenant/tenant.service';
import { PeriodPicker } from '../projects/period-picker';
import { FormulaChips } from './formula-chips';
import { FormulaField } from './formula-field';

/**
 * Editor de indicador personalizado com preview ao vivo.
 * Rotas: /indicadores/novo (com ?modelo=<nome> para partir de um modelo) e /indicadores/:id.
 */
@Component({
  selector: 'app-indicator-editor-page',
  imports: [
    FormsModule,
    RouterLink,
    DsAreaChart,
    DsButton,
    DsGlassCard,
    DsKpiTile,
    DsSkeleton,
    DsTextField,
    FormulaChips,
    FormulaField,
    PeriodPicker,
    LucideArrowLeft,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './indicator-editor.page.html',
  styleUrl: './indicator-editor.page.css',
})
export class IndicatorEditorPage {
  /** Parâmetro de rota (ausente em /indicadores/novo). */
  readonly id = input<string>();
  /** Query param ?modelo=<nome do modelo>. */
  readonly modelo = input<string>();

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);

  protected readonly unitOptions = UNIT_OPTIONS;
  protected readonly directionOptions = DIRECTION_OPTIONS;
  protected readonly decimalOptions = [0, 1, 2, 3, 4, 5, 6];
  protected readonly formatterFor = formatterFor;
  protected readonly kpiDirection = kpiDirection;

  private readonly tenantRequest = (url: string) => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  };

  protected readonly isNew = computed(() => !this.id());

  /* ---------- Dados de apoio ---------- */
  protected readonly catalog = httpResource<ApiEnvelope<MetricDefinition[]>>(() => API.metricsCatalog);
  protected readonly providers = httpResource<ApiEnvelope<Provider[]>>(() => this.tenantRequest(API.providers));
  protected readonly customs = httpResource<ApiEnvelope<CustomMetric[]>>(() => this.tenantRequest(API.customMetrics));
  protected readonly manuals = httpResource<ApiEnvelope<ManualMetric[]>>(() => this.tenantRequest(API.manualMetrics));
  private readonly manualList = computed(() => (this.manuals.hasValue() ? this.manuals.value().data : []));
  protected readonly templates = httpResource<ApiEnvelope<CustomMetricTemplate[]>>(() =>
    this.isNew() && this.modelo() ? this.tenantRequest(API.customMetricsTemplates) : undefined,
  );
  protected readonly projects = httpResource<ApiEnvelope<Project[]>>(() => this.tenantRequest(API.projects));

  private readonly customList = computed(() => (this.customs.hasValue() ? this.customs.value().data : []));
  protected readonly editing = computed(() => {
    const id = this.id();
    return id ? (this.customList().find((m) => m.id === id) ?? null) : null;
  });
  protected readonly notFound = computed(() => !!this.id() && this.customs.hasValue() && !this.editing());
  protected readonly projectList = computed(() => (this.projects.hasValue() ? this.projects.value().data : []));

  protected readonly options = computed(() =>
    formulaOptions(
      this.catalog.hasValue() ? this.catalog.value().data : [],
      this.providers.hasValue() ? this.providers.value().data : [],
      this.customList(),
      this.editing()?.key,
      this.manualList(),
    ),
  );
  protected readonly labels = computed(() =>
    referenceLabels(this.catalog.hasValue() ? this.catalog.value().data : [], this.customList(), this.manualList()),
  );

  protected readonly canEdit = computed(() => this.tenant.current()?.role !== 'client');

  /* ---------- Formulário ---------- */
  protected readonly draft = signal<CustomMetricDraft>({ ...EMPTY_DRAFT });
  private readonly prefilled = signal(false);
  protected readonly serverErrors = signal<FieldErrors>({});
  protected readonly saving = signal(false);

  constructor() {
    // Carrega o indicador (edição) ou o modelo escolhido (criação) uma única vez.
    effect(() => {
      if (untracked(this.prefilled)) return;
      const editing = this.editing();
      if (editing) {
        this.draft.set(draftFrom(editing));
        this.prefilled.set(true);
        return;
      }
      const name = this.modelo();
      if (this.isNew() && name && this.templates.hasValue()) {
        const template = this.templates.value().data.find((t) => t.name === name);
        if (template) this.draft.set(draftFrom(template));
        this.prefilled.set(true);
      }
    });

    // Preview ao vivo: qualquer mudança na fórmula, formato, projeto ou período reagenda.
    effect(() => {
      const tenantId = this.tenant.currentId();
      const draft = this.draft();
      const projectId = this.projectId();
      const range = this.range();
      const compare = this.compare();
      const ready = tenantId && projectId && range && !validateRange(range) && draft.formula.trim();
      this.preview.schedule(ready ? { tenantId, body: buildPreviewBody(draft, projectId, range, compare) } : null);
    });
  }

  protected patch(changes: Partial<CustomMetricDraft>): void {
    this.draft.update((d) => ({ ...d, ...changes }));
    const touched = Object.keys(changes);
    if (touched.some((k) => this.serverErrors()[k])) {
      this.serverErrors.update((errors) => {
        const rest = { ...errors };
        for (const key of touched) delete rest[key];
        return rest;
      });
    }
  }

  protected setUnit(event: Event): void {
    this.patch({ unit: (event.target as HTMLSelectElement).value as MetricUnit });
  }

  protected setDirection(event: Event): void {
    this.patch({ direction: (event.target as HTMLSelectElement).value as MetricDirection });
  }

  protected setDecimals(event: Event): void {
    this.patch({ decimals: Number((event.target as HTMLSelectElement).value) });
  }

  /* ---------- Preview ---------- */
  protected readonly preview = createFormulaPreview();
  private readonly chosenProject = signal<string | null>(null);
  protected readonly projectId = computed(() => {
    const chosen = this.chosenProject();
    const list = this.projectList();
    return chosen && list.some((p) => p.id === chosen) ? chosen : (list[0]?.id ?? null);
  });
  protected readonly preset = signal<PeriodPreset>('last_30');
  protected readonly compare = signal<CompareMode>('previous_period');
  protected readonly custom = signal<DateRange>(resolvePreset('last_30') ?? { start: '', end: '' });
  protected readonly range = computed<DateRange | null>(() =>
    this.preset() === 'custom' ? this.custom() : resolvePreset(this.preset()),
  );
  protected readonly rangeError = computed(() => {
    const range = this.range();
    return range ? validateRange(range) : 'Escolha um período.';
  });
  protected readonly comparisonCaption = computed(() => compareCaption(this.compare()));

  protected setProject(event: Event): void {
    this.chosenProject.set((event.target as HTMLSelectElement).value);
  }

  /** Erro da fórmula: o do salvamento tem prioridade; senão, o do preview. */
  protected readonly formulaError = computed(() => {
    const saved = this.serverErrors()['formula'];
    if (saved) return saved;
    const state = this.preview.state();
    return state.status === 'invalid' ? state.message : null;
  });

  /** Resultado exibido: o atual, ou o anterior (esmaecido) enquanto recalcula. */
  protected readonly previewResult = computed(() => {
    const state = this.preview.state();
    if (state.status === 'ready') return state.result;
    return state.status === 'loading' ? state.previous : null;
  });

  protected readonly previewMessage = computed(() => {
    const state = this.preview.state();
    switch (state.status) {
      case 'idle':
        return 'Escreva uma fórmula para ver o resultado.';
      case 'invalid':
        return 'Corrija a fórmula para ver o preview.';
      case 'error':
        return state.message;
      default:
        return null;
    }
  });

  protected trend(change: number | null): number | null {
    return this.compare() === 'none' || change === null ? null : change / 100;
  }

  /* ---------- Salvar ---------- */
  protected async save(): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId || !this.canEdit()) return;

    const body = buildCustomMetricBody(this.draft());
    const local: FieldErrors = {};
    if (!body.name) local['name'] = 'Dê um nome ao indicador.';
    if (!body.formula) local['formula'] = 'Escreva a fórmula.';
    if (Object.keys(local).length) {
      this.serverErrors.set(local);
      return;
    }

    this.saving.set(true);
    this.serverErrors.set({});
    const headers = { [TENANT_HEADER]: tenantId };
    const editing = this.editing();
    try {
      const res = editing
        ? await firstValueFrom(this.http.put<ApiEnvelope<CustomMetric>>(API.customMetric(editing.id), body, { headers }))
        : await firstValueFrom(this.http.post<ApiEnvelope<CustomMetric>>(API.customMetrics, body, { headers }));
      this.toast.success(editing ? 'Indicador atualizado' : 'Indicador criado', { message: res.data.name });
      await this.router.navigate(['/indicadores']);
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) {
        this.serverErrors.set(fields);
      } else if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
        this.toast.error('Não foi possível salvar o indicador');
      }
    } finally {
      this.saving.set(false);
    }
  }
}
