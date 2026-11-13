import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideChartLine,
  LucideCircleExclamationPoint,
  LucideFileText,
  LucideLayoutDashboard,
  LucidePlus,
  LucideSparkles,
  LucideTable,
  LucideTrash2,
} from '@lucide/angular';
import { DsButton, DsSkeleton, DsStatusBadge, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  Account,
  AiAnalysisBody,
  ApiEnvelope,
  CompareMode,
  CustomMetric,
  ManualMetric,
  DateRange,
  LayoutBlock,
  LayoutSection,
  MetricDefinition,
  Provider,
  ReportBlockType,
  ReportData,
  ReportFull,
  ReportLayout,
  Snapshot,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors, validationMessage } from '../../core/forms/server-errors';
import { PeriodPreset, formatRange, resolvePreset, validateRange } from '../../core/metrics/period';
import {
  BLOCK_TYPES,
  REPORT_LIMITS,
  ReportDraft,
  addBlock,
  addSection,
  blockTypeLabel,
  canMoveBlock,
  createBlock,
  createSection,
  draftSignature,
  findBlock,
  mapLayoutErrors,
  moveBlock,
  moveSection,
  pendingBlocks,
  previewLayout,
  removeBlock,
  removeSection,
  saveBody,
  updateBlock,
  updateSection,
  validateLayout,
} from '../../core/reports/report-layout';
import { metricOptions } from '../../core/reports/report-metrics';
import { HasUnsavedChanges } from '../../core/reports/unsaved-changes.guard';
import { TenantService } from '../../core/tenant/tenant.service';
import { AiAnalysisDialog } from '../ai/ai-analysis-dialog';
import { insertAnalysis } from '../ai/ai';
import { PeriodPicker } from '../projects/period-picker';
import { MetricPicker } from './metric-picker';
import { LiveLinks } from './live-links';
import { ReportVersions } from './report-versions';
import { ReportView } from './report-view';

/** Espera depois da última alteração antes de pedir a prévia (o backend limita 60/min). */
export const PREVIEW_DEBOUNCE_MS = 600;

type Selection =
  | { kind: 'block'; block: LayoutBlock; section: LayoutSection; sectionIndex: number; blockIndex: number }
  | { kind: 'section'; section: LayoutSection; sectionIndex: number }
  | null;

function httpStatus(error: unknown): number | null {
  if (error instanceof HttpErrorResponse) return error.status;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause instanceof HttpErrorResponse ? cause.status : null;
}

function quietError(error: unknown): boolean {
  // 403/5xx/rede já viram toast no interceptor global.
  const status = httpStatus(error);
  return status === 403 || status === 0 || (status ?? 0) >= 500;
}

/**
 * Montador de relatório. Rota: /relatorios/:id
 * Estrutura (seções e blocos) à esquerda, prévia ao vivo no centro (com os dados reais do
 * período, sem salvar) e inspetor do bloco à direita. Publicar congela uma versão.
 */
@Component({
  selector: 'app-report-editor-page',
  imports: [
    RouterLink,
    DsButton,
    DsSkeleton,
    DsStatusBadge,
    PeriodPicker,
    MetricPicker,
    ReportView,
    ReportVersions,
    LiveLinks,
    AiAnalysisDialog,
    LucideArrowLeft,
    LucideChartLine,
    LucideCircleExclamationPoint,
    LucideFileText,
    LucideLayoutDashboard,
    LucidePlus,
    LucideSparkles,
    LucideTable,
    LucideTrash2,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKeydown($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
  templateUrl: './report-editor.page.html',
  styleUrl: './report-editor.page.css',
})
export class ReportEditorPage implements HasUnsavedChanges {
  /** Parâmetro de rota. */
  readonly id = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);

  protected readonly blockTypes = BLOCK_TYPES;
  protected readonly limits = REPORT_LIMITS;
  protected readonly blockTypeLabel = blockTypeLabel;
  protected readonly formatRange = formatRange;
  protected readonly attentionLimits = Array.from({ length: REPORT_LIMITS.attentionMax }, (_, i) => i + 1);

  private readonly tenantRequest = (url: string) => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  };

  /* ---------- Dados ---------- */
  protected readonly report = httpResource<ApiEnvelope<ReportFull>>(() => this.tenantRequest(API.report(this.id())));
  protected readonly catalog = httpResource<ApiEnvelope<MetricDefinition[]>>(() => API.metricsCatalog);
  protected readonly providers = httpResource<ApiEnvelope<Provider[]>>(() => this.tenantRequest(API.providers));
  protected readonly customs = httpResource<ApiEnvelope<CustomMetric[]>>(() => this.tenantRequest(API.customMetrics));
  protected readonly manuals = httpResource<ApiEnvelope<ManualMetric[]>>(() => this.tenantRequest(API.manualMetrics));
  private readonly projectId = computed(() => (this.report.hasValue() ? (this.report.value().data.project?.id ?? null) : null));
  protected readonly linked = httpResource<ApiEnvelope<Account[]>>(() => {
    const projectId = this.projectId();
    return projectId ? this.tenantRequest(API.projectAccounts(projectId)) : undefined;
  });

  protected readonly options = computed(() =>
    metricOptions(
      this.catalog.hasValue() ? this.catalog.value().data : [],
      this.providers.hasValue() ? this.providers.value().data : [],
      this.customs.hasValue() ? this.customs.value().data : [],
      this.linked.hasValue() ? this.linked.value().data.map((a) => a.provider) : [],
      this.manuals.hasValue() ? this.manuals.value().data : [],
    ),
  );
  private readonly optionLabel = computed(() => new Map(this.options().map((o) => [o.key, o.label])));

  protected readonly notFound = computed(() => httpStatus(this.report.error()) === 404);
  protected readonly canEdit = computed(() => this.tenant.current()?.role !== 'client');

  /* ---------- Rascunho ---------- */
  readonly title = signal('');
  readonly preset = signal<PeriodPreset>('last_30');
  readonly custom = signal<DateRange>({ start: '', end: '' });
  readonly compare = signal<CompareMode>('previous_period');
  readonly layout = signal<ReportLayout>({ sections: [] });
  readonly loaded = signal(false);
  private readonly savedSignature = signal('');
  private loadedId: string | null = null;

  private readonly draft = computed<ReportDraft>(() => ({
    title: this.title(),
    preset: this.preset(),
    custom: this.custom(),
    compare: this.compare(),
    layout: this.layout(),
  }));
  readonly dirty = computed(() => this.loaded() && draftSignature(this.draft()) !== this.savedSignature());

  protected readonly range = computed<DateRange | null>(() =>
    this.preset() === 'custom' ? this.custom() : resolvePreset(this.preset()),
  );
  protected readonly rangeError = computed(() => {
    const range = this.range();
    if (range) return validateRange(range);
    return this.preset() === 'this_month' ? 'Hoje é dia 1: "Este mês" ainda não tem dias com dados.' : 'Escolha um período.';
  });

  /* ---------- Seleção e erros ---------- */
  readonly selectedId = signal<string | null>(null);
  protected readonly selection = computed<Selection>(() => {
    const id = this.selectedId();
    if (!id) return null;
    const layout = this.layout();
    const at = findBlock(layout, id);
    if (at) return { kind: 'block', ...at };
    const sectionIndex = layout.sections.findIndex((s) => s.id === id);
    return sectionIndex >= 0 ? { kind: 'section', section: layout.sections[sectionIndex], sectionIndex } : null;
  });

  /** Erros do servidor (422) por id de seção/bloco. */
  readonly serverErrors = signal<Record<string, string>>({});
  /** Erros gerais (título, período). */
  readonly generalErrors = signal<FieldErrors>({});
  /** Problemas que ainda impedem salvar (blocos incompletos, seção sem título). */
  protected readonly problems = computed(() => validateLayout(this.layout()));
  protected readonly pending = computed(() => pendingBlocks(this.layout()));
  protected readonly confirmingRemove = signal<string | null>(null);
  protected readonly addingTo = signal<string | null>(null);

  protected errorFor(id: string): string | null {
    return this.serverErrors()[id] ?? null;
  }

  /* ---------- Prévia ao vivo ---------- */
  readonly preview = signal<ReportData | null>(null);
  readonly previewLoading = signal(false);
  readonly previewError = signal<string | null>(null);
  private previewSeq = 0;

  private readonly previewBody = computed(() => {
    if (!this.loaded() || this.rangeError()) return null;
    const body = saveBody({ ...this.draft(), layout: previewLayout(this.layout()) });
    return JSON.stringify({ ...body, title: body.title || 'Relatório sem título' });
  });

  /* ---------- Copiloto de IA ---------- */
  readonly aiOpen = signal(false);
  /** O que vai para a análise: o estado atual do editor, sem os blocos incompletos. */
  protected readonly aiBody = computed<AiAnalysisBody>(() => {
    const body = saveBody({ ...this.draft(), layout: previewLayout(this.layout()) });
    return {
      period_preset: body.period_preset,
      period_start: body.period_start ?? null,
      period_end: body.period_end ?? null,
      compare: body.compare,
      layout: body.layout,
    };
  });

  /** Insere o rascunho da IA (substitui o texto de análise, se houver) e mostra o bloco. */
  insertAnalysis(text: string): void {
    const result = insertAnalysis(this.layout(), text);
    this.aiOpen.set(false);
    if (!result) {
      this.toast.info('Não há espaço para mais um bloco', { message: 'Remova uma seção ou um bloco e tente de novo.' });
      return;
    }
    this.layout.set(result.layout);
    this.select(result.blockId);
    this.clearServerError(result.blockId);
    this.toast.success(result.replaced ? 'Análise substituída' : 'Análise inserida', {
      message: 'Revise o texto antes de publicar: ele é uma sugestão da IA.',
    });
  }

  /* ---------- Ações ---------- */
  readonly saving = signal(false);
  readonly publishing = signal(false);
  readonly tab = signal<'preview' | 'versions' | 'live'>('preview');
  private readonly versions = viewChild(ReportVersions);

  constructor() {
    effect(() => {
      const report = this.report.hasValue() ? this.report.value().data : null;
      if (!report) return;
      untracked(() => {
        if (this.loadedId !== report.id) this.applyReport(report);
      });
    });

    effect((onCleanup) => {
      const body = this.previewBody();
      if (!body) return;
      const timer = setTimeout(() => void this.renderPreview(body), PREVIEW_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.save();
    }
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  private applyReport(report: ReportFull): void {
    this.title.set(report.title);
    this.preset.set(report.period_preset);
    this.custom.set(
      report.period_start && report.period_end
        ? { start: report.period_start, end: report.period_end }
        : (resolvePreset('last_30') ?? { start: '', end: '' }),
    );
    this.compare.set(report.compare);
    this.layout.set(report.layout);
    this.savedSignature.set(draftSignature(this.draft()));
    this.loadedId = report.id;
    this.loaded.set(true);
  }

  private async renderPreview(body: string): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId) return;
    const seq = ++this.previewSeq;
    this.previewLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiEnvelope<ReportData>>(API.reportRender(this.id()), JSON.parse(body), {
          headers: { [TENANT_HEADER]: tenantId },
        }),
      );
      if (seq !== this.previewSeq) return;
      this.preview.set(res.data);
      this.previewError.set(null);
    } catch (error) {
      if (seq !== this.previewSeq) return;
      const fields = extractFieldErrors(error);
      this.previewError.set(
        (fields && Object.values(fields)[0]) ?? validationMessage(error) ?? 'Não foi possível atualizar a prévia.',
      );
    } finally {
      if (seq === this.previewSeq) this.previewLoading.set(false);
    }
  }

  /* ---------- Estrutura ---------- */

  protected select(id: string): void {
    this.selectedId.set(id);
    this.confirmingRemove.set(null);
  }

  addSection(): void {
    if (this.layout().sections.length >= REPORT_LIMITS.sections) {
      this.toast.info(`O relatório pode ter no máximo ${REPORT_LIMITS.sections} seções.`);
      return;
    }
    const section = createSection();
    this.layout.update((layout) => addSection(layout, section));
    this.select(section.id);
  }

  addBlock(sectionId: string, type: ReportBlockType): void {
    const section = this.layout().sections.find((s) => s.id === sectionId);
    if (!section) return;
    if (section.blocks.length >= REPORT_LIMITS.blocks) {
      this.toast.info(`Cada seção pode ter no máximo ${REPORT_LIMITS.blocks} blocos.`);
      return;
    }
    const block = createBlock(type);
    this.layout.update((layout) => addBlock(layout, sectionId, block));
    this.addingTo.set(null);
    this.select(block.id);
  }

  updateBlock(blockId: string, patch: Partial<LayoutBlock>): void {
    this.layout.update((layout) => updateBlock(layout, blockId, patch));
    this.clearServerError(blockId);
  }

  renameSection(sectionId: string, title: string): void {
    this.layout.update((layout) => updateSection(layout, sectionId, { title: title.slice(0, REPORT_LIMITS.title) }));
    this.clearServerError(sectionId);
  }

  moveBlock(blockId: string, delta: -1 | 1): void {
    this.layout.update((layout) => moveBlock(layout, blockId, delta));
  }

  protected canMoveBlock(blockId: string, delta: -1 | 1): boolean {
    return canMoveBlock(this.layout(), blockId, delta);
  }

  moveSection(sectionId: string, delta: -1 | 1): void {
    this.layout.update((layout) => moveSection(layout, sectionId, delta));
  }

  /** Remover pede confirmação: o primeiro clique arma, o segundo remove. */
  remove(id: string): void {
    if (this.confirmingRemove() !== id) {
      this.confirmingRemove.set(id);
      return;
    }
    const isBlock = !!findBlock(this.layout(), id);
    this.layout.update((layout) => (isBlock ? removeBlock(layout, id) : removeSection(layout, id)));
    this.confirmingRemove.set(null);
    if (this.selectedId() === id) this.selectedId.set(null);
    this.clearServerError(id);
  }

  protected blockSummary(block: LayoutBlock): string {
    const label = (key: string) => this.optionLabel().get(key) ?? key;
    switch (block.type) {
      case 'kpis':
      case 'table':
        return block.metrics.length === 0
          ? 'escolha as métricas'
          : block.metrics.length <= 2
            ? block.metrics.map(label).join(', ')
            : `${block.metrics.length} métricas`;
      case 'chart':
        return block.metric ? label(block.metric) : 'escolha a métrica';
      case 'text':
        return block.content.trim() ? block.content.trim().replace(/\s+/g, ' ').slice(0, 40) : 'texto vazio';
      case 'attention':
        return `até ${block.limit} sinais`;
    }
  }

  protected metricsOf(block: LayoutBlock): string[] {
    return block.type === 'kpis' || block.type === 'table' ? block.metrics : block.type === 'chart' && block.metric ? [block.metric] : [];
  }

  private clearServerError(id: string): void {
    if (!(id in this.serverErrors())) return;
    this.serverErrors.update((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
  }

  /* ---------- Salvar e publicar ---------- */

  /** Salva o rascunho. Devolve true se ficou tudo salvo. */
  async save(): Promise<boolean> {
    const tenantId = this.tenant.currentId();
    if (!tenantId || this.saving() || !this.loaded()) return false;

    const general: FieldErrors = {};
    if (!this.title().trim()) general['title'] = 'Dê um título ao relatório.';
    if (this.rangeError()) general['period'] = this.rangeError() ?? '';
    const problems = this.problems();
    this.generalErrors.set(general);
    if (Object.keys(general).length || Object.keys(problems).length) {
      this.serverErrors.set(problems);
      const first = Object.keys(problems)[0];
      if (first) this.select(first);
      this.toast.error('Revise os pontos marcados antes de salvar', {
        message: Object.values(general)[0] ?? problems[first] ?? undefined,
      });
      return false;
    }

    const draft = this.draft();
    this.saving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiEnvelope<ReportFull>>(API.report(this.id()), saveBody(draft), {
          headers: { [TENANT_HEADER]: tenantId },
        }),
      );
      // O servidor normaliza (ids, espaços): o salvo passa a ser a resposta — sem perder o que foi
      // digitado durante o envio.
      const stillSame = draftSignature(this.draft()) === draftSignature(draft);
      if (stillSame) {
        this.layout.set(res.data.layout);
        this.title.set(res.data.title);
      }
      this.savedSignature.set(draftSignature({ ...draft, title: res.data.title, layout: res.data.layout }));
      this.serverErrors.set({});
      this.generalErrors.set({});
      this.report.set({ data: res.data });
      return true;
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) {
        const mapped = mapLayoutErrors(fields, draft.layout);
        this.serverErrors.set(mapped.byId);
        this.generalErrors.set(mapped.general);
        const first = Object.keys(mapped.byId)[0];
        if (first) this.select(first);
        this.toast.error('Revise os pontos marcados', {
          message: Object.values(mapped.byId)[0] ?? Object.values(mapped.general)[0],
        });
      } else if (!quietError(error)) {
        this.toast.error('Não foi possível salvar o relatório');
      }
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /** Salva (se preciso) e publica uma versão com os números congelados. */
  async publish(): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId || this.publishing()) return;
    if (this.dirty() && !(await this.save())) return;

    this.publishing.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiEnvelope<Snapshot>>(API.reportSnapshots(this.id()), {}, { headers: { [TENANT_HEADER]: tenantId } }),
      );
      this.toast.success('Versão publicada', {
        message: `${formatRange(res.data.period)}. O PDF fica pronto em alguns segundos.`,
      });
      this.tab.set('versions');
      this.versions()?.reload();
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) {
        this.toast.error('Não foi possível publicar', { message: Object.values(fields)[0] });
      } else if (!quietError(error)) {
        this.toast.error('Não foi possível publicar');
      }
    } finally {
      this.publishing.set(false);
    }
  }
}
