import { NgTemplateOutlet } from '@angular/common';
import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowLeft } from '@lucide/angular';
import { DsAreaChart, DsButton, DsGlassCard, DsKpiTile, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  Account,
  ApiEnvelope,
  AttentionResult,
  AttentionSignal,
  CompareMode,
  Connection,
  CustomMetric,
  DateRange,
  MetricResult,
  MetricsQueryResult,
  Project,
  Provider,
  TENANT_HEADER,
  TimelineEvent,
  UpdateProjectAccountsBody,
  UpdateProjectBody,
} from '../../core/api/api.types';
import { AttentionService, statusFor } from '../../core/attention/attention';
import { ProjectActions } from '../actions/project-actions';
import { ProjectCopilot } from '../ai/project-copilot';
import { ProjectContacts } from '../contacts/project-contacts';
import { ProjectGoalList } from '../goals/project-goal-list';
import { ProjectManualValues } from '../manual/project-manual-values';
import { ProjectTimeline } from '../timeline/project-timeline';
import { chartMarkers } from '../timeline/timeline';
import { FieldErrors, extractFieldErrors, validationMessage } from '../../core/forms/server-errors';
import { relevantCustomMetrics } from '../../core/metrics/custom-metrics';
import { MetricsQueryService, formatterFor, kpiDirection } from '../../core/metrics/metrics-query.service';
import {
  PeriodPreset,
  compareCaption,
  formatRange,
  lastAvailableDay,
  resolvePreset,
  toIsoDate,
  validateRange,
} from '../../core/metrics/period';
import { TenantService } from '../../core/tenant/tenant.service';
import { AttentionRadar } from './attention-radar';
import { LinkedAccounts } from './linked-accounts';
import { nicheLabel } from './niches';
import { PeriodPicker } from './period-picker';
import { ProjectHealthCard } from './project-health';
import { ProjectGoalsPanel } from './project-goals';
import { ProjectReports } from './project-reports';
import { ProjectPosts } from '../publishing/project-posts';

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function httpStatus(error: unknown): number | null {
  if (error instanceof HttpErrorResponse) return error.status;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause instanceof HttpErrorResponse ? cause.status : null;
}

/** Detalhe do projeto: contas vinculadas, período e KPIs com gráfico. Rota: /projetos/:id */
@Component({
  selector: 'app-project-detail-page',
  imports: [
    ProjectActions,
    ProjectCopilot,
    ProjectHealthCard,
    ProjectContacts,
    ProjectGoalList,
    ProjectManualValues,
    ProjectTimeline,
    NgTemplateOutlet,
    RouterLink,
    DsAreaChart,
    DsButton,
    DsGlassCard,
    DsKpiTile,
    DsSkeleton,
    AttentionRadar,
    LinkedAccounts,
    PeriodPicker,
    ProjectGoalsPanel,
    ProjectReports,
    ProjectPosts,
    LucideArrowLeft,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-detail.page.html',
  styleUrl: './project-detail.page.css',
})
export class ProjectDetailPage {
  /** Parâmetro de rota (withComponentInputBinding). */
  readonly id = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  private readonly query = inject(MetricsQueryService);
  private readonly attentionService = inject(AttentionService);
  protected readonly tenant = inject(TenantService);

  protected readonly nicheLabel = nicheLabel;
  protected readonly formatRange = formatRange;
  protected readonly kpiDirection = kpiDirection;
  protected readonly formatterFor = formatterFor;

  private readonly tenantRequest = (url: string) => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  };

  protected readonly project = httpResource<ApiEnvelope<Project>>(() => this.tenantRequest(API.project(this.id())));
  protected readonly linked = httpResource<ApiEnvelope<Account[]>>(() =>
    this.tenantRequest(API.projectAccounts(this.id())),
  );
  protected readonly connections = httpResource<ApiEnvelope<Connection[]>>(() => this.tenantRequest(API.connections));
  protected readonly providers = httpResource<ApiEnvelope<Provider[]>>(() => this.tenantRequest(API.providers));
  protected readonly customMetrics = httpResource<ApiEnvelope<CustomMetric[]>>(() =>
    this.tenantRequest(API.customMetrics),
  );

  /** Linha do tempo: alimenta a seção e os marcos do gráfico (uma requisição só). */
  protected readonly timeline = httpResource<ApiEnvelope<TimelineEvent[]>>(() =>
    this.tenantRequest(API.projectTimeline(this.id())),
  );
  protected readonly timelineEvents = computed(() => (this.timeline.hasValue() ? this.timeline.value().data : null));
  protected readonly linkedProviders = computed(() => this.linkedAccounts().map((a) => a.provider));

  protected readonly linkedAccounts = computed(() => (this.linked.hasValue() ? this.linked.value().data : []));
  protected readonly connectionList = computed(() =>
    this.connections.hasValue() ? this.connections.value().data : [],
  );
  protected readonly providerName = computed(() => {
    const names = new Map((this.providers.hasValue() ? this.providers.value().data : []).map((p) => [p.key, p.name]));
    return (key: string) => names.get(key) ?? key;
  });

  protected readonly notFound = computed(() => httpStatus(this.project.error()) === 404);
  protected readonly canEdit = computed(() => this.tenant.current()?.role !== 'client');
  protected readonly savingAccounts = signal(false);

  /* ---------- Período ---------- */
  protected readonly preset = signal<PeriodPreset>('last_30');
  protected readonly compare = signal<CompareMode>('previous_period');
  protected readonly custom = signal<DateRange>(resolvePreset('last_30') ?? { start: '', end: '' });
  protected readonly lastDayLabel = formatRange({ start: toIsoDate(lastAvailableDay()), end: toIsoDate(lastAvailableDay()) });

  protected readonly range = computed<DateRange | null>(() =>
    this.preset() === 'custom' ? this.custom() : resolvePreset(this.preset()),
  );
  protected readonly rangeError = computed(() => {
    const range = this.range();
    return range ? validateRange(range) : 'Escolha um período.';
  });
  protected readonly comparisonCaption = computed(() => compareCaption(this.compare()));

  /* ---------- Métricas ---------- */

  /** Indicadores personalizados que usam alguma plataforma vinculada (ou nenhuma plataforma). */
  protected readonly relevantCustoms = computed(() =>
    relevantCustomMetrics(
      this.customMetrics.hasValue() ? this.customMetrics.value().data : [],
      this.linkedAccounts().map((a) => a.provider),
    ),
  );
  /** Sem a lista de indicadores (carregando), a consulta espera, para não ir duas vezes. */
  private readonly customsSettled = computed(() => this.customMetrics.hasValue() || !!this.customMetrics.error());

  protected readonly metricKeys = computed(
    () => [
      ...this.query.featuredMetricsFor(this.linkedAccounts(), this.providers.hasValue() ? this.providers.value().data : []),
      ...this.relevantCustoms().map((m) => m.key),
    ],
    { equal: sameList },
  );

  protected readonly metrics = httpResource<ApiEnvelope<MetricsQueryResult>>(() => {
    const tenantId = this.tenant.currentId();
    const range = this.range();
    const keys = this.metricKeys();
    if (!tenantId || !range || this.rangeError() || keys.length === 0 || !this.customsSettled()) return undefined;
    return this.query.request(this.id(), tenantId, this.query.buildBody(range, this.compare(), keys));
  });

  protected readonly results = computed<MetricResult[]>(() =>
    this.metrics.hasValue() ? this.metrics.value().data.metrics : [],
  );
  protected readonly featuredResults = computed(() => this.results().filter((m) => !m.key.startsWith('custom:')));
  protected readonly customResults = computed(() => this.results().filter((m) => m.key.startsWith('custom:')));
  protected readonly metricsError = computed(() => {
    const error = this.metrics.error();
    if (!error) return null;
    const cause = error instanceof HttpErrorResponse ? error : (error as { cause?: unknown }).cause;
    return validationMessage(cause) ?? 'Não foi possível carregar os indicadores.';
  });

  /* ---------- Semáforo de atenção (§7.2) ---------- */

  /** Ids das contas vinculadas: o radar reavalia quando o conjunto muda. */
  private readonly linkedIds = computed(() => this.linkedAccounts().map((a) => a.id).join(','));

  protected readonly attention = httpResource<ApiEnvelope<AttentionResult>>(() => {
    const tenantId = this.tenant.currentId();
    const range = this.range();
    if (!tenantId || !range || this.rangeError() || !this.linked.hasValue() || this.linkedIds() === '') return undefined;
    return this.attentionService.request(this.id(), tenantId, range);
  });

  protected readonly attentionResult = computed(() => (this.attention.hasValue() ? this.attention.value().data : null));
  protected readonly attentionError = computed(() =>
    this.attention.error() ? 'Não foi possível avaliar o radar de atenção.' : null,
  );
  protected readonly metricKeysInGrid = computed(() => this.results().map((m) => m.key));

  /* ---------- Plano de ação ---------- */

  private readonly actionsSection = viewChild(ProjectActions);
  /** Nomes das métricas já carregadas (para o texto de resultado das ações). */
  protected readonly metricLabels = computed<Record<string, string>>(() =>
    Object.fromEntries(this.results().map((m) => [m.key, m.label])),
  );

  /** "Criar ação" num sinal do radar: abre o formulário do plano já preenchido. */
  protected createAction(signal: AttentionSignal): void {
    this.actionsSection()?.createFrom(signal);
  }

  /** Selo do semáforo no KPI (nulo = métrica não avaliada pelas regras). */
  protected statusOf(metricKey: string) {
    return statusFor(this.attentionResult()?.statuses ?? null, metricKey);
  }

  /** Sinal clicado: seleciona o KPI da métrica e leva até o gráfico. */
  protected focusMetric(metricKey: string): void {
    this.selectedKey.set(metricKey);
    const chart = document.getElementById('metric-chart');
    if (chart && typeof chart.scrollIntoView === 'function') {
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      chart.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
    }
  }

  /* ---------- Metas do projeto ---------- */

  protected readonly goalsEditing = signal(false);
  protected readonly savingGoals = signal(false);
  protected readonly goalsErrors = signal<FieldErrors>({});

  protected async saveGoals(body: UpdateProjectBody): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId) return;

    this.savingGoals.set(true);
    this.goalsErrors.set({});
    try {
      const res = await firstValueFrom(
        this.http.patch<ApiEnvelope<Project>>(API.project(this.id()), body, { headers: { [TENANT_HEADER]: tenantId } }),
      );
      this.project.set(res);
      this.goalsEditing.set(false);
      this.attention.reload(); // as metas mudam o que as regras consideram problema
      this.toast.success('Metas atualizadas');
    } catch (error) {
      const fields = extractFieldErrors(error);
      const status = httpStatus(error);
      if (fields) {
        this.goalsErrors.set(fields);
      } else if (status !== 403 && status !== 0 && (status ?? 500) < 500) {
        // 403/5xx/rede já viram toast no interceptor global.
        this.toast.error('Não foi possível salvar as metas');
      }
    } finally {
      this.savingGoals.set(false);
    }
  }

  protected readonly selectedKey = signal<string | null>(null);
  protected readonly selected = computed(() => {
    const list = this.results();
    return list.find((m) => m.key === this.selectedKey()) ?? list[0] ?? null;
  });

  /** Marcos da linha do tempo dentro do período, desenhados no gráfico. */
  protected readonly markers = computed(() => {
    const range = this.range();
    const events = this.timelineEvents();
    return range && events ? chartMarkers(events, range.start, range.end) : [];
  });

  protected trend(metric: MetricResult): number | null {
    return this.compare() === 'none' || metric.change_pct === null ? null : metric.change_pct / 100;
  }

  protected async saveAccounts(accountIds: string[]): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId) return;

    this.savingAccounts.set(true);
    const body: UpdateProjectAccountsBody = { account_ids: accountIds };
    try {
      const res = await firstValueFrom(
        this.http.put<ApiEnvelope<Account[]>>(API.projectAccounts(this.id()), body, {
          headers: { [TENANT_HEADER]: tenantId },
        }),
      );
      this.linked.set(res);
      this.toast.success('Contas vinculadas atualizadas');
    } catch (error) {
      const status = httpStatus(error);
      // 403/5xx/rede já viram toast no interceptor global.
      if (status !== 403 && status !== 0 && (status ?? 500) < 500) {
        this.toast.error('Não foi possível salvar', { message: validationMessage(error) ?? undefined });
      }
    } finally {
      this.savingAccounts.set(false);
    }
  }
}
