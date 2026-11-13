import { HttpClient, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideFileText, LucidePlus, LucideTrash2, LucideX } from '@lucide/angular';
import { DsButton, DsGlassCard, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ApiEnvelope,
  CompareMode,
  CreateReportBody,
  DateRange,
  Project,
  ReportFull,
  ReportSummary,
  ReportTemplate,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors } from '../../core/forms/server-errors';
import { relativeTime } from '../../core/format/relative-time';
import { PeriodPreset, resolvePreset, validateRange } from '../../core/metrics/period';
import { suggestedTitle } from '../../core/reports/report-layout';
import { TenantService } from '../../core/tenant/tenant.service';
import { nicheLabel } from '../projects/niches';
import { PeriodPicker } from '../projects/period-picker';

/** Modelo sugerido para o nicho do projeto (sem nicho/"outro" → redes sociais e marca). */
export function suggestedTemplate(templates: readonly ReportTemplate[], niche: string | null | undefined): string | null {
  return templates.find((t) => t.niche === niche)?.key ?? templates.find((t) => t.key === 'redes_sociais')?.key ?? templates[0]?.key ?? null;
}

interface ProjectGroup {
  project: { id: string; name: string };
  reports: ReportSummary[];
}

/** Agrupa por projeto (na ordem alfabética), mantendo a ordem dos relatórios. */
export function groupByProject(reports: readonly ReportSummary[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const report of reports) {
    const project = report.project ?? { id: '-', name: 'Sem projeto' };
    let group = groups.get(project.id);
    if (!group) {
      group = { project: { id: project.id, name: project.name }, reports: [] };
      groups.set(project.id, group);
    }
    group.reports.push(report);
  }
  return [...groups.values()].sort((a, b) => a.project.name.localeCompare(b.project.name, 'pt-BR'));
}

/** Relatórios da agência. Rota: /relatorios (com ?novo=<projeto> abre a criação já no projeto). */
@Component({
  selector: 'app-reports-page',
  imports: [RouterLink, DsButton, DsGlassCard, DsSkeleton, PeriodPicker, LucideFileText, LucidePlus, LucideTrash2, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports.page.html',
  styleUrl: './reports.page.css',
})
export class ReportsPage {
  /** Query param: abre "Novo relatório" com este projeto. */
  readonly novo = input<string>();

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);

  protected readonly relativeTime = relativeTime;
  protected readonly nicheLabel = nicheLabel;

  protected readonly canManage = computed(() => !!this.tenant.current() && this.tenant.current()?.role !== 'client');

  private readonly tenantRequest = (url: string, params?: Record<string, string>) => {
    const tenantId = this.tenant.currentId();
    return tenantId && this.canManage() ? { url, params, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  };

  readonly projectFilter = signal('');
  protected readonly reports = httpResource<ApiEnvelope<ReportSummary[]>>(() =>
    this.tenantRequest(API.reports, this.projectFilter() ? { project_id: this.projectFilter() } : undefined),
  );
  protected readonly projects = httpResource<ApiEnvelope<Project[]>>(() => this.tenantRequest(API.projects));
  protected readonly templates = httpResource<ApiEnvelope<ReportTemplate[]>>(() => this.tenantRequest(API.reportTemplates));

  protected readonly projectList = computed(() => (this.projects.hasValue() ? this.projects.value().data : []));
  protected readonly templateList = computed(() => (this.templates.hasValue() ? this.templates.value().data : []));
  protected readonly groups = computed(() => groupByProject(this.reports.hasValue() ? this.reports.value().data : []));

  /* ---------- Novo relatório ---------- */
  readonly creatingOpen = signal(false);
  readonly projectId = signal('');
  readonly template = signal<string | null>(null);
  readonly title = signal('');
  readonly preset = signal<PeriodPreset>('last_month');
  readonly custom = signal<DateRange>(resolvePreset('last_30') ?? { start: '', end: '' });
  readonly compare = signal<CompareMode>('previous_period');
  readonly errors = signal<FieldErrors>({});
  readonly creating = signal(false);
  private titleTouched = false;

  protected readonly selectedProject = computed(() => this.projectList().find((p) => p.id === this.projectId()) ?? null);
  protected readonly suggested = computed(() => suggestedTemplate(this.templateList(), this.selectedProject()?.niche));
  protected readonly range = computed(() => (this.preset() === 'custom' ? this.custom() : resolvePreset(this.preset())));
  protected readonly rangeError = computed(() => {
    const range = this.range();
    return range ? validateRange(range) : 'Escolha um período com dias de dados.';
  });

  readonly confirmingDelete = signal<string | null>(null);

  constructor() {
    // ?novo=<projeto>: abre a criação já no projeto.
    effect(() => {
      const projectId = this.novo();
      if (!projectId) return;
      untracked(() => this.openNew(projectId));
    });

    // Modelo e título sugeridos acompanham o projeto e o período (até a pessoa mexer).
    effect(() => {
      const suggested = this.suggested();
      untracked(() => this.template.set(suggested));
    });
    effect(() => {
      const title = suggestedTitle(this.range()?.end);
      untracked(() => {
        if (!this.titleTouched) this.title.set(title);
      });
    });
  }

  openNew(projectId = ''): void {
    this.projectId.set(projectId || this.projectFilter() || '');
    this.errors.set({});
    this.titleTouched = false;
    this.title.set(suggestedTitle(this.range()?.end));
    this.creatingOpen.set(true);
  }

  protected setTitle(value: string): void {
    this.titleTouched = true;
    this.title.set(value);
  }

  async create(): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId || this.creating()) return;

    const errors: FieldErrors = {};
    if (!this.projectId()) errors['project_id'] = 'Escolha o projeto do relatório.';
    if (this.title().trim().length < 2) errors['title'] = 'Dê um título ao relatório.';
    if (this.rangeError()) errors['period'] = this.rangeError() ?? '';
    this.errors.set(errors);
    if (Object.keys(errors).length) return;

    const custom = this.preset() === 'custom';
    const body: CreateReportBody = {
      project_id: this.projectId(),
      title: this.title().trim(),
      period_preset: this.preset(),
      compare: this.compare(),
      ...(this.template() ? { template: this.template()! } : {}),
      ...(custom ? { period_start: this.custom().start, period_end: this.custom().end } : {}),
    };

    this.creating.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiEnvelope<ReportFull>>(API.reports, body, { headers: { [TENANT_HEADER]: tenantId } }),
      );
      this.toast.success('Relatório criado', { message: 'Revise a análise e publique quando estiver pronto.' });
      await this.router.navigate(['/relatorios', res.data.id]);
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) this.errors.set(fields);
    } finally {
      this.creating.set(false);
    }
  }

  async remove(report: ReportSummary): Promise<void> {
    if (this.confirmingDelete() !== report.id) {
      this.confirmingDelete.set(report.id);
      return;
    }
    const tenantId = this.tenant.currentId();
    if (!tenantId) return;
    try {
      await firstValueFrom(this.http.delete(API.report(report.id), { headers: { [TENANT_HEADER]: tenantId } }));
      this.toast.success('Relatório excluído', { message: 'As versões publicadas e os links dele também saíram do ar.' });
      this.reports.update((current) => ({ data: (current?.data ?? []).filter((r) => r.id !== report.id) }));
    } catch {
      /* 403/5xx: toast no interceptor */
    } finally {
      this.confirmingDelete.set(null);
    }
  }
}
