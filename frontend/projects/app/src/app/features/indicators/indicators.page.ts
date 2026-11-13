import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucidePencil, LucidePlus, LucideSigma, LucideSparkles, LucideTrash2 } from '@lucide/angular';
import { DsButton, DsGlassCard, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ApiEnvelope,
  CustomMetric,
  CustomMetricTemplate,
  MetricDefinition,
  Provider,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { extractFieldErrors } from '../../core/forms/server-errors';
import { directionLabel, referenceLabels, unitLabel } from '../../core/metrics/custom-metrics';
import { TenantService } from '../../core/tenant/tenant.service';
import { FormulaChips } from './formula-chips';

/** Lista de indicadores personalizados da agência + galeria de modelos. Rota: /indicadores */
@Component({
  selector: 'app-indicators-page',
  imports: [
    RouterLink,
    DsButton,
    DsGlassCard,
    DsSkeleton,
    FormulaChips,
    LucidePlus,
    LucidePencil,
    LucideTrash2,
    LucideSigma,
    LucideSparkles,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './indicators.page.html',
  styleUrl: './indicators.page.css',
})
export class IndicatorsPage {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);

  protected readonly unitLabel = unitLabel;
  protected readonly directionLabel = directionLabel;

  private readonly tenantRequest = (url: string) => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  };

  protected readonly customs = httpResource<ApiEnvelope<CustomMetric[]>>(() => this.tenantRequest(API.customMetrics));
  protected readonly templates = httpResource<ApiEnvelope<CustomMetricTemplate[]>>(() =>
    this.tenantRequest(API.customMetricsTemplates),
  );
  protected readonly catalog = httpResource<ApiEnvelope<MetricDefinition[]>>(() => API.metricsCatalog);
  protected readonly providers = httpResource<ApiEnvelope<Provider[]>>(() => this.tenantRequest(API.providers));

  protected readonly items = computed(() => (this.customs.hasValue() ? this.customs.value().data : []));
  protected readonly templateItems = computed(() => (this.templates.hasValue() ? this.templates.value().data : []));
  protected readonly labels = computed(() =>
    referenceLabels(this.catalog.hasValue() ? this.catalog.value().data : [], this.items()),
  );
  protected readonly providerName = computed(() => {
    const names = new Map((this.providers.hasValue() ? this.providers.value().data : []).map((p) => [p.key, p.name]));
    return (key: string) => names.get(key) ?? key;
  });

  protected readonly canEdit = computed(() => this.tenant.current()?.role !== 'client');
  protected readonly loadError = computed(() => (this.customs.error() ? 'Não foi possível carregar os indicadores.' : null));

  /** Exclusão em dois passos, dentro do próprio card. */
  protected readonly confirmingId = signal<string | null>(null);
  protected readonly deletingId = signal<string | null>(null);
  protected readonly deleteErrors = signal<Record<string, string>>({});

  protected useTemplate(template: CustomMetricTemplate): void {
    void this.router.navigate(['/indicadores/novo'], { queryParams: { modelo: template.name } });
  }

  protected askDelete(metric: CustomMetric): void {
    this.deleteErrors.update((errors) => {
      const rest = { ...errors };
      delete rest[metric.id];
      return rest;
    });
    this.confirmingId.set(metric.id);
  }

  protected async remove(metric: CustomMetric): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId) return;

    this.deletingId.set(metric.id);
    try {
      await firstValueFrom(this.http.delete(API.customMetric(metric.id), { headers: { [TENANT_HEADER]: tenantId } }));
      this.customs.update((current) => ({ data: (current?.data ?? []).filter((m) => m.id !== metric.id) }));
      this.toast.success('Indicador excluído', { message: metric.name });
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) {
        const message = fields['id'] ?? Object.values(fields)[0] ?? 'Não foi possível excluir.';
        this.deleteErrors.update((errors) => ({ ...errors, [metric.id]: message }));
        this.toast.error('Indicador em uso', { message });
      } else if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
        this.toast.error('Não foi possível excluir o indicador');
      }
    } finally {
      this.deletingId.set(null);
      this.confirmingId.set(null);
    }
  }
}
