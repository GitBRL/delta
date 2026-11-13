import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DsButton, DsSkeleton, DsTextField, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, ConsentRecord, Contact } from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors } from '../../core/forms/server-errors';
import { relativeTime } from '../../core/format/relative-time';
import {
  CHANNEL_LABEL,
  CONSENT_SOURCE_LABEL,
  ContactDraft,
  EMPTY_CONTACT,
  contactBody,
  draftFrom,
  validateContact,
} from './contacts';

/**
 * Contatos do cliente final (quem recebe os relatórios), com consentimento por canal.
 * Só a equipe vê. O histórico de consentimento é imutável (LGPD e regras da Meta).
 */
@Component({
  selector: 'app-project-contacts',
  imports: [FormsModule, DsButton, DsSkeleton, DsTextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h2 class="m-0 text-headline">Contatos</h2>
      <button ds-button variant="ghost" size="sm" (click)="openNew()">Adicionar</button>
    </div>
    <p class="m-0 text-footnote text-fg-muted">Quem recebe os relatórios por e-mail ou WhatsApp. Só envia para quem autorizou.</p>

    @if (contacts.isLoading() && !contacts.hasValue()) {
      <ds-skeleton width="70%" />
      <ds-skeleton width="50%" />
    } @else if (contacts.error()) {
      <p class="m-0 text-footnote text-fg-muted" role="alert">
        Não foi possível carregar os contatos.
        <button ds-button variant="ghost" size="sm" (click)="contacts.reload()">Tentar de novo</button>
      </p>
    } @else if (list().length === 0) {
      <p class="m-0 text-footnote text-fg-muted">Nenhum contato ainda. Cadastre quem acompanha este cliente.</p>
    } @else {
      <ul class="list">
        @for (c of list(); track c.id) {
          <li class="contact" [attr.data-contact]="c.id">
            <div class="row">
              <div class="min-w-0 flex-1">
                <strong class="block truncate">{{ c.name }}</strong>
                <small class="block truncate text-fg-muted">{{ c.role ? c.role + ' · ' : '' }}{{ c.email ?? '' }}{{ c.email && c.phone_display ? ' · ' : '' }}{{ c.phone_display ?? '' }}</small>
              </div>
              <div class="actions">
                <button type="button" class="link" (click)="openEdit(c)">Editar</button>
                <button type="button" class="link" (click)="toggleHistory(c)" [attr.aria-expanded]="historyFor() === c.id">Histórico</button>
              </div>
            </div>
            <div class="chips">
              <span class="chip" [class.on]="c.email_opt_in" [attr.data-channel]="'email'">
                {{ c.email_opt_in ? '✓' : '–' }} E-mail
              </span>
              <span class="chip" [class.on]="c.whatsapp_opt_in" [attr.data-channel]="'whatsapp'">
                {{ c.whatsapp_opt_in ? '✓' : '–' }} WhatsApp
              </span>
            </div>
            @if (historyFor() === c.id) {
              <div class="history" animate.enter="ds-enter-fade-up">
                @if (history.isLoading()) {
                  <ds-skeleton width="80%" />
                } @else if (historyList().length === 0) {
                  <p class="m-0 text-caption text-fg-muted">Sem registros de consentimento.</p>
                } @else {
                  <ul>
                    @for (h of historyList(); track $index) {
                      <li>
                        <strong>{{ h.granted ? 'Autorizou' : 'Retirou' }} {{ channelLabel[h.channel] }}</strong>
                        {{ sourceLabel[h.source] }}{{ h.recorded_by ? ' (' + h.recorded_by + ')' : '' }} · {{ relativeTime(h.created_at) }}
                      </li>
                    }
                  </ul>
                }
              </div>
            }
          </li>
        }
      </ul>
    }

    @if (editing(); as mode) {
      <div class="backdrop" (click)="close()" aria-hidden="true"></div>
      <div class="dialog ds-glass" role="dialog" aria-modal="true" aria-labelledby="contact-dialog-title" animate.enter="ds-enter-scale">
        <h3 id="contact-dialog-title" class="m-0 text-title-3 font-semibold">{{ mode === 'new' ? 'Novo contato' : 'Editar contato' }}</h3>
        <form class="form" (submit)="$event.preventDefault(); save()" novalidate>
          <ds-text-field label="Nome" name="contact_name" autocomplete="off" [ngModel]="draft().name" (ngModelChange)="patch({ name: $event })" [error]="errors()['name'] ?? null" [maxlength]="120" />
          <ds-text-field label="Cargo (opcional)" name="contact_role" autocomplete="off" [ngModel]="draft().role" (ngModelChange)="patch({ role: $event })" [error]="errors()['role'] ?? null" [maxlength]="80" />
          <ds-text-field label="E-mail" type="email" name="contact_email" autocomplete="off" [ngModel]="draft().email" (ngModelChange)="patch({ email: $event })" [error]="errors()['email'] ?? null" />
          <ds-text-field
            label="WhatsApp"
            type="tel"
            name="contact_phone"
            autocomplete="off"
            placeholder="11 99999-8888"
            hint="DDD + número; outros países com +código."
            [ngModel]="draft().phone"
            (ngModelChange)="patch({ phone: $event })"
            [error]="errors()['phone'] ?? null"
          />
          <fieldset class="consents">
            <legend>Consentimento</legend>
            <label class="check" [class.disabled]="!draft().email.trim()">
              <input type="checkbox" name="email_opt_in" [checked]="draft().email_opt_in" [disabled]="!draft().email.trim()" (change)="patch({ email_opt_in: checked($event) })" />
              <span>Confirmo que este contato autorizou receber relatórios por e-mail</span>
            </label>
            <label class="check" [class.disabled]="!draft().phone.trim()">
              <input type="checkbox" name="whatsapp_opt_in" [checked]="draft().whatsapp_opt_in" [disabled]="!draft().phone.trim()" (change)="patch({ whatsapp_opt_in: checked($event) })" />
              <span>Confirmo que este contato autorizou receber relatórios por WhatsApp</span>
            </label>
            <p class="m-0 text-caption text-fg-muted">Cada mudança fica registrada com data e autor. O contato pode sair a qualquer momento pelo link do e-mail ou respondendo PARAR.</p>
          </fieldset>
          <div class="dialog-actions">
            @if (mode !== 'new') {
              @if (confirmRemove()) {
                <span class="text-footnote">Remover este contato?</span>
                <button ds-button type="button" variant="ghost" size="sm" (click)="confirmRemove.set(false)">Não</button>
                <button ds-button type="button" variant="destructive" size="sm" [loading]="busy()" (click)="remove(mode)">Remover</button>
              } @else {
                <button ds-button type="button" variant="ghost" size="sm" class="mr-auto" (click)="confirmRemove.set(true)">Remover</button>
              }
            }
            <span class="spacer"></span>
            <button ds-button type="button" variant="secondary" size="sm" (click)="close()">Cancelar</button>
            <button ds-button type="submit" size="sm" [loading]="busy()">Salvar</button>
          </div>
        </form>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .contact {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
    }
    .row {
      display: flex;
      align-items: flex-start;
      gap: var(--ds-space-2);
    }
    .actions {
      display: flex;
      gap: var(--ds-space-2);
    }
    .link {
      border: 0;
      background: none;
      padding: 0;
      color: var(--ds-accent);
      font: var(--ds-text-footnote);
      font-weight: 600;
      cursor: pointer;
    }
    .chips {
      display: flex;
      gap: 6px;
    }
    .chip {
      padding: 1px 8px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-bg-elevated);
      color: var(--ds-text-tertiary);
      font: var(--ds-text-caption);
      font-weight: 600;
    }
    .chip.on {
      background: color-mix(in srgb, var(--ds-status-healthy) 16%, transparent);
      color: var(--ds-text);
    }
    .history ul {
      margin: 0;
      padding-left: var(--ds-space-4);
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
    }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 40;
      background: rgb(0 0 0 / 0.32);
    }
    .dialog {
      position: fixed;
      z-index: 41;
      top: 50%;
      left: 50%;
      width: min(480px, calc(100vw - 32px));
      max-height: calc(100dvh - 32px);
      overflow: auto;
      transform: translate(-50%, -50%);
      padding: var(--ds-space-6);
      border-radius: var(--ds-radius-xl, 20px);
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .consents {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin: 0;
      padding: var(--ds-space-3);
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
    }
    .consents legend {
      padding: 0 4px;
      font: var(--ds-text-footnote);
      font-weight: 600;
    }
    .check {
      display: flex;
      align-items: flex-start;
      gap: var(--ds-space-2);
      font: var(--ds-text-subhead);
      cursor: pointer;
    }
    .check input {
      margin-top: 3px;
      accent-color: var(--ds-accent);
    }
    .check.disabled {
      opacity: 0.5;
      cursor: default;
    }
    .dialog-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .spacer {
      flex: 1;
    }
  `,
})
export class ProjectContacts {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);

  readonly projectId = input.required<string>();

  protected readonly channelLabel = CHANNEL_LABEL;
  protected readonly sourceLabel = CONSENT_SOURCE_LABEL;
  protected readonly relativeTime = relativeTime;

  protected readonly contacts = httpResource<ApiEnvelope<Contact[]>>(() => API.projectContacts(this.projectId()));
  protected readonly list = computed(() => (this.contacts.hasValue() ? this.contacts.value().data : []));

  /** 'new' ou o id do contato em edição. */
  readonly editing = signal<string | null>(null);
  readonly draft = signal<ContactDraft>(EMPTY_CONTACT);
  readonly errors = signal<FieldErrors>({});
  readonly busy = signal(false);
  readonly confirmRemove = signal(false);

  readonly historyFor = signal<string | null>(null);
  protected readonly history = httpResource<ApiEnvelope<ConsentRecord[]>>(() => {
    const id = this.historyFor();
    return id ? API.contactConsents(id) : undefined;
  });
  protected readonly historyList = computed(() => (this.history.hasValue() ? this.history.value().data : []));

  openNew(): void {
    this.open('new', EMPTY_CONTACT);
  }

  openEdit(contact: Contact): void {
    this.open(contact.id, draftFrom(contact));
  }

  close(): void {
    this.editing.set(null);
  }

  protected toggleHistory(contact: Contact): void {
    this.historyFor.update((id) => (id === contact.id ? null : contact.id));
  }

  protected patch(change: Partial<ContactDraft>): void {
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

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  async save(): Promise<void> {
    const mode = this.editing();
    if (!mode || this.busy()) return;

    const clientErrors = validateContact(this.draft());
    if (Object.keys(clientErrors).length > 0) {
      this.errors.set(clientErrors);
      return;
    }

    this.busy.set(true);
    try {
      const body = contactBody(this.draft());
      const saved = await firstValueFrom(
        mode === 'new'
          ? this.http.post<ApiEnvelope<Contact>>(API.projectContacts(this.projectId()), body)
          : this.http.put<ApiEnvelope<Contact>>(API.contact(mode), body),
      );
      this.contacts.update((current) => {
        const list = current?.data ?? [];
        const next = mode === 'new' ? [...list, saved.data] : list.map((c) => (c.id === saved.data.id ? saved.data : c));
        return { data: next.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) };
      });
      if (this.historyFor() === saved.data.id) this.history.reload();
      this.toast.success(mode === 'new' ? 'Contato cadastrado' : 'Contato atualizado');
      this.close();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }

  async remove(id: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.delete(API.contact(id)));
      this.contacts.update((current) => ({ data: (current?.data ?? []).filter((c) => c.id !== id) }));
      this.toast.success('Contato removido');
      this.close();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }

  private open(mode: string, draft: ContactDraft): void {
    this.draft.set(draft);
    this.errors.set({});
    this.confirmRemove.set(false);
    this.editing.set(mode);
  }

  private handleError(error: unknown): void {
    const fields = extractFieldErrors(error);
    if (fields) {
      this.errors.set(fields);
      return;
    }
    if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
      this.toast.error('Não foi possível salvar o contato');
    }
  }
}
