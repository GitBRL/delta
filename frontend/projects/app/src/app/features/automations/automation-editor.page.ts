import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DsButton, DsGlassCard, DsSkeleton, DsTextField, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ApiEnvelope,
  Automation,
  AutomationFrequency,
  AutomationRun,
  Contact,
  ContactChannel,
  MessagePreview,
  RelativePeriodPreset,
  ReportSummary,
  WhatsAppResponse,
} from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors } from '../../core/forms/server-errors';
import { relativeTime } from '../../core/format/relative-time';
import { TenantService } from '../../core/tenant/tenant.service';
import { channelBlocker } from '../contacts/contacts';
import {
  AUTOMATION_PERIODS,
  AutomationDraft,
  EMPTY_AUTOMATION,
  FREQUENCIES,
  MESSAGE_MAX,
  VARIABLES,
  WEEKDAYS,
  automationBody,
  draftFromAutomation,
  insertVariable,
  suggestedPeriod,
  validateAutomation,
} from './automations';
import { MessagePreviewCard } from './message-preview';
import { RunHistory } from './run-history';

/** Espera depois da última mudança antes de pedir a prévia (o backend limita 30/min). */
export const PREVIEW_DEBOUNCE_MS = 800;

type Tab = 'config' | 'history';

/** Recebe pelo menos um dos canais escolhidos? Senão, o motivo (para o item ficar desabilitado). */
export function recipientBlocker(contact: Contact, channels: readonly ContactChannel[]): string | null {
  if (channels.length === 0) return 'Escolha um canal';
  const reasons = channels.map((channel) => channelBlocker(contact, channel));
  return reasons.every((r) => r !== null) ? reasons.join(' · ') : null;
}

/** Canais (dos escolhidos) pelos quais o contato recebe. */
export function receivingChannels(contact: Contact, channels: readonly ContactChannel[]): ContactChannel[] {
  return channels.filter((channel) => channelBlocker(contact, channel) === null);
}

/** Erros do 422 no campo-base ("channels.0" → "channels"). */
export function baseFieldErrors(errors: FieldErrors): FieldErrors {
  const out: FieldErrors = {};
  for (const [key, message] of Object.entries(errors)) {
    const base = key.split('.')[0];
    out[base] ??= message;
  }
  return out;
}

/** /envios/novo e /envios/:id — configurar o envio automático, ver a prévia e o histórico. */
@Component({
  selector: 'app-automation-editor-page',
  imports: [FormsModule, RouterLink, DsButton, DsGlassCard, DsSkeleton, DsTextField, MessagePreviewCard, RunHistory],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './automation-editor.page.html',
  styleUrl: './automation-editor.page.css',
})
export class AutomationEditorPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  private readonly router = inject(Router);
  protected readonly tenant = inject(TenantService);

  /** Vem da rota (/envios/:id); ausente em /envios/novo. */
  readonly id = input<string>();

  protected readonly frequencies = FREQUENCIES;
  protected readonly weekdays = WEEKDAYS;
  protected readonly periods = AUTOMATION_PERIODS;
  protected readonly variables = VARIABLES;
  protected readonly messageMax = MESSAGE_MAX;
  protected readonly monthDays = Array.from({ length: 28 }, (_, i) => i + 1);
  protected readonly relativeTime = relativeTime;
  protected readonly recipientBlocker = recipientBlocker;
  protected readonly receivingChannels = receivingChannels;

  readonly creating = computed(() => !this.id());
  readonly tab = signal<Tab>(inject(ActivatedRoute).snapshot.queryParamMap.get('aba') === 'historico' ? 'history' : 'config');

  protected readonly automation = httpResource<ApiEnvelope<Automation>>(() => {
    const id = this.id();
    return id ? API.automation(id) : undefined;
  });
  protected readonly reports = httpResource<ApiEnvelope<ReportSummary[]>>(() => (this.creating() ? API.reports : undefined));
  /** Só dono/admin enxerga a configuração do WhatsApp (os demais recebem 403). */
  protected readonly whatsapp = httpResource<WhatsAppResponse>(() => (this.tenant.isAdmin() ? API.whatsapp : undefined));

  readonly draft = signal<AutomationDraft>(EMPTY_AUTOMATION);
  private readonly saved = signal<string>(JSON.stringify(EMPTY_AUTOMATION));
  readonly dirty = computed(() => JSON.stringify(this.draft()) !== this.saved());
  readonly errors = signal<FieldErrors>({});
  readonly saving = signal(false);
  readonly runningNow = signal(false);
  readonly confirmRun = signal(false);
  /** O usuário escolheu o período à mão: a frequência para de sugerir. */
  private periodTouched = false;

  protected readonly reportList = computed(() => (this.reports.hasValue() ? this.reports.value().data : []));
  protected readonly current = computed(() => (this.automation.hasValue() ? this.automation.value().data : null));

  /** Projeto do relatório escolhido (na edição, o da automação). */
  readonly projectId = computed(() => {
    const current = this.current();
    if (current) return current.project?.id ?? null;
    return this.reportList().find((r) => r.id === this.draft().report_id)?.project?.id ?? null;
  });

  protected readonly contacts = httpResource<ApiEnvelope<Contact[]>>(() => {
    const projectId = this.projectId();
    return projectId ? API.projectContacts(projectId) : undefined;
  });
  protected readonly contactList = computed(() => (this.contacts.hasValue() ? this.contacts.value().data : []));

  protected readonly whatsappMode = computed(() => (this.whatsapp.hasValue() ? this.whatsapp.value().data.mode : null));

  // Prévia ao vivo
  readonly preview = signal<MessagePreview | null>(null);
  readonly previewLoading = signal(false);
  readonly previewError = signal<string | null>(null);
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private previewSeq = 0;

  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('messageBox');
  private readonly history = viewChild(RunHistory);

  constructor() {
    // Carrega a automação existente no rascunho (uma vez por id).
    effect(() => {
      const a = this.current();
      if (!a) return;
      untracked(() => {
        const draft = draftFromAutomation(a);
        this.draft.set(draft);
        this.saved.set(JSON.stringify(draft));
        this.periodTouched = true;
      });
    });

    // Prévia: relatório, período, mensagem e primeiro destinatário.
    effect(() => {
      const d = this.draft();
      const reportId = d.report_id || this.current()?.report?.id || '';
      const request = { report_id: reportId, period_preset: d.period_preset, message: d.message, contact_id: d.recipient_ids[0] ?? null };
      untracked(() => this.schedulePreview(request));
    });

    inject(DestroyRef).onDestroy(() => clearTimeout(this.previewTimer));
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
  }

  protected patch(change: Partial<AutomationDraft>): void {
    this.draft.update((d) => ({ ...d, ...change }));
    for (const field of Object.keys(change)) {
      if (this.errors()[field]) {
        this.errors.update((all) => {
          const next = { ...all };
          delete next[field];
          return next;
        });
      }
    }
  }

  protected setReport(reportId: string): void {
    // Outro projeto, outros contatos: limpa a seleção.
    this.patch({ report_id: reportId, recipient_ids: [] });
  }

  protected setFrequency(frequency: AutomationFrequency): void {
    this.patch(this.periodTouched ? { frequency } : { frequency, period_preset: suggestedPeriod(frequency) });
  }

  protected setPeriod(preset: RelativePeriodPreset): void {
    this.periodTouched = true;
    this.patch({ period_preset: preset });
  }

  protected toggleChannel(channel: ContactChannel, on: boolean): void {
    const channels = on ? [...new Set([...this.draft().channels, channel])] : this.draft().channels.filter((c) => c !== channel);
    this.patch({ channels: (['email', 'whatsapp'] as const).filter((c) => channels.includes(c)) });
  }

  protected toggleRecipient(contact: Contact, on: boolean): void {
    const ids = this.draft().recipient_ids;
    this.patch({ recipient_ids: on ? [...ids, contact.id] : ids.filter((id) => id !== contact.id) });
  }

  protected insert(variable: string): void {
    const box = this.textarea()?.nativeElement;
    const text = this.draft().message;
    const start = box?.selectionStart ?? text.length;
    const end = box?.selectionEnd ?? start;
    const result = insertVariable(text, variable, start, end);
    this.patch({ message: result.text });
    queueMicrotask(() => {
      box?.focus();
      box?.setSelectionRange(result.cursor, result.cursor);
    });
  }

  /** "{{contato}}" — montado aqui porque chaves duplas no template viram interpolação. */
  protected token(key: string): string {
    return '{' + '{' + key + '}' + '}';
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  async save(): Promise<Automation | null> {
    if (this.saving()) return null;
    const creating = this.creating();
    const clientErrors = validateAutomation(this.draft(), creating);
    if (Object.keys(clientErrors).length > 0) {
      this.errors.set(clientErrors);
      this.tab.set('config');
      return null;
    }

    this.saving.set(true);
    try {
      const body = automationBody(this.draft(), creating);
      const res = await firstValueFrom(
        creating
          ? this.http.post<ApiEnvelope<Automation>>(API.automations, body)
          : this.http.put<ApiEnvelope<Automation>>(API.automation(this.id()!), body),
      );
      this.saved.set(JSON.stringify(this.draft()));
      this.toast.success(creating ? 'Envio criado' : 'Envio salvo', { message: res.data.active ? res.data.schedule_label : 'Pausado.' });
      if (creating) {
        void this.router.navigate(['/envios', res.data.id], { replaceUrl: true });
      } else {
        this.automation.set({ data: res.data });
      }
      return res.data;
    } catch (error) {
      this.handleError(error, 'Não foi possível salvar o envio');
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  protected askRunNow(): void {
    if (this.dirty()) {
      this.toast.info('Salve antes de enviar', { message: 'O envio usa a configuração salva.' });
      return;
    }
    this.confirmRun.set(true);
  }

  async runNow(): Promise<void> {
    const id = this.id();
    if (!id || this.runningNow()) return;
    this.runningNow.set(true);
    try {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<AutomationRun>>(API.automationRunNow(id), {}));
      this.confirmRun.set(false);
      this.tab.set('history');
      queueMicrotask(() => this.history()?.show(res.data));
      this.toast.success(res.data.status === 'awaiting_approval' ? 'Pronto para revisar' : 'Envio iniciado', {
        message: res.data.status === 'awaiting_approval' ? 'A versão foi publicada e espera a sua aprovação.' : 'Acompanhe a entrega no histórico.',
      });
      this.automation.reload();
    } catch (error) {
      this.handleError(error, 'Não foi possível enviar agora');
    } finally {
      this.runningNow.set(false);
    }
  }

  private schedulePreview(request: { report_id: string; period_preset: RelativePeriodPreset; message: string; contact_id: string | null }): void {
    clearTimeout(this.previewTimer);
    if (!request.report_id || request.message.trim().length < 2) {
      this.previewLoading.set(false);
      return;
    }
    this.previewLoading.set(true);
    const seq = ++this.previewSeq;
    this.previewTimer = setTimeout(async () => {
      try {
        const res = await firstValueFrom(this.http.post<ApiEnvelope<MessagePreview>>(API.automationsPreview, request));
        if (seq !== this.previewSeq) return;
        this.preview.set(res.data);
        this.previewError.set(null);
      } catch (error) {
        if (seq !== this.previewSeq) return;
        const fields = extractFieldErrors(error);
        this.previewError.set(
          fields ? (Object.values(fields)[0] ?? 'Revise a mensagem.') : 'Não foi possível gerar a prévia agora.',
        );
      } finally {
        if (seq === this.previewSeq) this.previewLoading.set(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
  }

  private handleError(error: unknown, title: string): void {
    const fields = extractFieldErrors(error);
    if (fields) {
      this.errors.set(baseFieldErrors(fields));
      this.tab.set('config');
      this.toast.error(title, { message: Object.values(fields)[0] });
      return;
    }
    if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
      this.toast.error(title);
    }
  }
}
