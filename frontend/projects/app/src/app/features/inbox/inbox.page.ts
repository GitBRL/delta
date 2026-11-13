import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideMessageCircle, LucideSend } from '@lucide/angular';
import { DsButton, DsGlassCard, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ApiEnvelope,
  InboxConversation,
  InboxMessage,
  InboxThread,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { extractFieldErrors, validationMessage } from '../../core/forms/server-errors';
import { relativeTime } from '../../core/format/relative-time';
import { pollWhile } from '../../core/polling/poll-while';
import { TenantService } from '../../core/tenant/tenant.service';
import {
  INBOX_POLL_MS,
  InboxStore,
  OUT_STATUS,
  REPLY_MAX,
  conversationTitle,
  groupByDay,
  lastMessagePreview,
  messageTime,
  normalizePhone,
  windowClosesText,
} from './inbox';

/**
 * Conversas do WhatsApp (equipe): o que os clientes respondem aos relatórios. Resposta livre só
 * dentro da janela de 24 h desde a última mensagem do cliente (regra da Meta). ADR 0023.
 */
@Component({
  selector: 'app-inbox-page',
  imports: [RouterLink, DsButton, DsGlassCard, DsSkeleton, LucideArrowLeft, LucideMessageCircle, LucideSend],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.has-selection]': '!!selected()' },
  template: `
    <header class="page-head">
      <div>
        <h1 class="m-0 text-large-title font-bold tracking-tight">Conversas</h1>
        <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
          Respostas dos clientes aos relatórios enviados pelo WhatsApp. Dá para responder em até 24 horas depois da última
          mensagem do cliente.
        </p>
      </div>
      @if (sandbox()) {
        <button ds-button variant="secondary" size="sm" (click)="simulating.set(!simulating())" [attr.aria-expanded]="simulating()">
          Simular mensagem do cliente
        </button>
      }
    </header>

    @if (!isStaff()) {
      <ds-glass-card padding="lg" role="note">
        <p class="m-0 text-headline">As conversas são da equipe da agência.</p>
      </ds-glass-card>
    } @else {
      @if (simulating()) {
        <ds-glass-card padding="lg" class="simulate">
          <form class="sim-form" (submit)="$event.preventDefault(); simulate()" novalidate aria-label="Simular mensagem do cliente">
            <p class="m-0 text-footnote text-fg-muted sim-note">
              Só no modo demonstração: a mensagem entra como se o cliente tivesse respondido, sem sair do Delta.
            </p>
            <label class="field">
              <span>Telefone do cliente</span>
              <input name="sim_phone" type="tel" placeholder="+55 11 99999-0000" [value]="simPhone()" (input)="simPhone.set($any($event.target).value); simError.set(null)" />
            </label>
            <label class="field grow">
              <span>Mensagem</span>
              <input name="sim_text" type="text" maxlength="1000" placeholder="Ex.: Obrigado! Podemos aumentar a verba?" [value]="simText()" (input)="simText.set($any($event.target).value); simError.set(null)" />
            </label>
            <button ds-button type="submit" size="sm" [loading]="simBusy()">Simular</button>
            @if (simError()) {
              <small class="error sim-note" role="alert">{{ simError() }}</small>
            }
          </form>
        </ds-glass-card>
      }

      <div class="inbox">
        <!-- Lista -->
        <section class="list ds-glass" aria-label="Conversas">
          @if (store.resource.isLoading() && !store.resource.hasValue()) {
            <div class="pad"><ds-skeleton width="80%" /><ds-skeleton width="60%" /><ds-skeleton width="70%" /></div>
          } @else if (store.resource.error() && !store.resource.hasValue()) {
            <div class="pad" role="alert">
              <p class="m-0 text-footnote">Não foi possível carregar as conversas.</p>
              <button ds-button variant="secondary" size="sm" (click)="store.reload()">Tentar de novo</button>
            </div>
          } @else if (store.conversations().length === 0) {
            <div class="empty">
              <svg lucideMessageCircle [size]="28" aria-hidden="true"></svg>
              <p class="m-0 text-headline">Nenhuma conversa ainda</p>
              <p class="m-0 text-footnote text-fg-muted">Quando um cliente responder a um relatório pelo WhatsApp, a conversa aparece aqui.</p>
            </div>
          } @else {
            <ul class="items">
              @for (c of store.conversations(); track c.phone) {
                <li>
                  <button
                    type="button"
                    class="item"
                    [class.active]="selected() === c.phone"
                    [attr.aria-current]="selected() === c.phone ? 'true' : null"
                    (click)="open(c)"
                  >
                    <span class="avatar" aria-hidden="true">{{ initials(c) }}</span>
                    <span class="item-main">
                      <span class="item-top">
                        <strong class="name">{{ title(c) }}</strong>
                        <span class="when">{{ c.last_message.created_at ? relativeTime(c.last_message.created_at) : '' }}</span>
                      </span>
                      <span class="item-bottom">
                        <span class="preview">{{ preview(c) }}</span>
                        @if (c.unread > 0) {
                          <span class="unread" [attr.aria-label]="c.unread + (c.unread === 1 ? ' não lida' : ' não lidas')">{{ c.unread }}</span>
                        }
                      </span>
                      @if (c.window_open) {
                        <span class="window-dot">Janela aberta</span>
                      }
                    </span>
                  </button>
                </li>
              }
            </ul>
          }
        </section>

        <!-- Conversa -->
        <section class="thread ds-glass" aria-label="Conversa">
          @if (!selected()) {
            <div class="empty">
              <p class="m-0 text-footnote text-fg-muted">Escolha uma conversa.</p>
            </div>
          } @else if (thread.isLoading() && !threadData()) {
            <div class="pad"><ds-skeleton width="40%" height="20px" /><ds-skeleton width="70%" /><ds-skeleton width="55%" /></div>
          } @else if (thread.error() && !threadData()) {
            <div class="pad" role="alert">
              <p class="m-0 text-footnote">Não foi possível abrir a conversa.</p>
              <button ds-button variant="secondary" size="sm" (click)="thread.reload()">Tentar de novo</button>
            </div>
          } @else if (threadData(); as t) {
            <header class="thread-head">
              <button type="button" class="back" (click)="selected.set(null)" aria-label="Voltar para as conversas">
                <svg lucideArrowLeft [size]="18"></svg>
              </button>
              <div class="min-w-0 flex-1">
                <h2 class="m-0 text-headline">{{ title(t) }}</h2>
                <p class="m-0 text-caption text-fg-muted">
                  {{ t.phone_display }}
                  @if (t.contact?.project_id; as projectId) {
                    · <a [routerLink]="['/projetos', projectId]">Ver projeto</a>
                  }
                </p>
              </div>
            </header>

            <div class="messages" aria-live="polite">
              @for (group of groups(); track group.day + $index) {
                <p class="day"><span>{{ group.day }}</span></p>
                @for (m of group.messages; track m.id) {
                  <div class="bubble" [attr.data-dir]="m.direction">
                    <span class="ds-visually-hidden">{{ m.direction === 'in' ? 'Cliente:' : 'Você:' }}</span>
                    <p class="body">{{ m.body }}</p>
                    <span class="meta">
                      {{ time(m.created_at) }}
                      @if (m.direction === 'out' && m.status && outStatus[m.status]) {
                        · {{ outStatus[m.status] }}
                      }
                    </span>
                  </div>
                }
              }
            </div>

            <form class="composer" (submit)="$event.preventDefault(); send()" novalidate>
              @if (t.window_open) {
                <p class="window" data-testid="window-open">Janela aberta até {{ closes(t.window_closes_at) }}</p>
              } @else {
                <p class="window closed" data-testid="window-closed" role="note">
                  Fora da janela de 24 horas: pelas regras do WhatsApp, a resposta livre só é possível depois que o cliente
                  mandar uma nova mensagem. Os envios automáticos com template aprovado continuam funcionando.
                </p>
              }
              <div class="compose-row">
                <label class="ds-visually-hidden" for="reply-text">Resposta</label>
                <textarea
                  id="reply-text"
                  name="reply"
                  rows="2"
                  [attr.maxlength]="replyMax"
                  [disabled]="!t.window_open || sending()"
                  [placeholder]="t.window_open ? 'Escreva a resposta (Enter envia, Shift+Enter quebra a linha)' : 'Janela fechada'"
                  [value]="draft()"
                  (input)="draft.set($any($event.target).value); replyError.set(null)"
                  (keydown.enter)="onEnter($event)"
                  [attr.aria-invalid]="!!replyError()"
                ></textarea>
                <button ds-button type="submit" [loading]="sending()" [disabled]="!t.window_open || !draft().trim()" aria-label="Enviar resposta">
                  <svg lucideSend [size]="16"></svg>
                  Enviar
                </button>
              </div>
              @if (replyError()) {
                <small class="error" role="alert">{{ replyError() }}</small>
              }
            </form>
          }
        </section>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .page-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--ds-space-3);
      margin-bottom: var(--ds-space-6);
    }
    .simulate {
      display: block;
      margin-bottom: var(--ds-space-4);
    }
    .sim-form {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--ds-space-3);
    }
    .sim-note {
      flex-basis: 100%;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .field.grow {
      flex: 1 1 240px;
    }
    .field input {
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
    }
    .inbox {
      display: grid;
      grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
      gap: var(--ds-space-4);
      height: calc(100dvh - 220px);
      min-height: 420px;
    }
    .list,
    .thread {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
      border-radius: var(--ds-radius-xl);
    }
    .pad {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      padding: var(--ds-space-5);
    }
    .empty {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--ds-space-2);
      padding: var(--ds-space-6);
      color: var(--ds-text-secondary);
      text-align: center;
    }
    .items {
      margin: 0;
      padding: var(--ds-space-2);
      overflow-y: auto;
      list-style: none;
    }
    .item {
      display: flex;
      gap: var(--ds-space-3);
      width: 100%;
      padding: 10px;
      border: 0;
      border-radius: var(--ds-radius-md);
      background: none;
      color: var(--ds-text);
      text-align: left;
      cursor: pointer;
    }
    .item:hover,
    .item.active {
      background: var(--ds-fill);
    }
    .item:focus-visible {
      outline: 2px solid var(--ds-accent);
      outline-offset: -2px;
    }
    .avatar {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: color-mix(in oklch, var(--ds-accent) 14%, transparent);
      color: var(--ds-accent);
      font: var(--ds-text-footnote);
      font-weight: 700;
    }
    .item-main {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .item-top,
    .item-bottom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-2);
    }
    .name,
    .preview {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .name {
      font: var(--ds-text-subhead);
      font-weight: 600;
    }
    .preview {
      font: var(--ds-text-footnote);
      color: var(--ds-text-secondary);
    }
    .when {
      flex: none;
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
    .unread {
      display: inline-grid;
      flex: none;
      place-items: center;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-accent);
      color: #fff;
      font: var(--ds-text-caption);
      font-weight: 700;
    }
    .window-dot {
      font: var(--ds-text-caption);
      color: var(--ds-status-healthy);
    }
    .thread-head {
      display: flex;
      align-items: center;
      gap: var(--ds-space-2);
      padding: var(--ds-space-4) var(--ds-space-5);
      border-bottom: 1px solid var(--ds-separator);
    }
    .thread-head a {
      color: var(--ds-accent);
    }
    .back {
      display: none;
      flex: none;
      place-items: center;
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: 50%;
      background: var(--ds-fill);
      color: var(--ds-text);
      cursor: pointer;
    }
    .messages {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 6px;
      padding: var(--ds-space-4) var(--ds-space-5);
      overflow-y: auto;
    }
    .day {
      align-self: center;
      margin: var(--ds-space-2) 0;
    }
    .day span {
      padding: 2px 10px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-fill);
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
    }
    .bubble {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-width: min(75%, 560px);
      padding: 8px 12px;
      border-radius: 16px 16px 16px 4px;
      background: var(--ds-fill);
    }
    .bubble[data-dir='out'] {
      align-self: flex-end;
      border-radius: 16px 16px 4px 16px;
      background: color-mix(in oklch, var(--ds-accent) 18%, transparent);
    }
    .body {
      margin: 0;
      font: var(--ds-text-subhead);
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .meta {
      align-self: flex-end;
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
    .composer {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      padding: var(--ds-space-3) var(--ds-space-5) var(--ds-space-4);
      border-top: 1px solid var(--ds-separator);
    }
    .window {
      margin: 0;
      font: var(--ds-text-caption);
      color: var(--ds-status-healthy);
    }
    .window.closed {
      color: var(--ds-text-secondary);
    }
    .compose-row {
      display: flex;
      align-items: flex-end;
      gap: var(--ds-space-2);
    }
    .compose-row textarea {
      flex: 1;
      min-height: 44px;
      max-height: 160px;
      padding: 10px 12px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-subhead);
      resize: vertical;
    }
    .compose-row textarea:disabled {
      opacity: 0.6;
    }
    .error {
      color: var(--ds-status-critical);
      font: var(--ds-text-footnote);
    }
    /* Celular: uma tela de cada vez (lista ou conversa). */
    @media (max-width: 860px) {
      .inbox {
        grid-template-columns: 1fr;
        height: calc(100dvh - 180px);
      }
      :host(.has-selection) .list,
      :host(:not(.has-selection)) .thread {
        display: none;
      }
      .back {
        display: inline-grid;
      }
      .bubble {
        max-width: 88%;
      }
    }
  `,
})
export class InboxPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);
  protected readonly store = inject(InboxStore);

  protected readonly relativeTime = relativeTime;
  protected readonly title = conversationTitle;
  protected readonly preview = lastMessagePreview;
  protected readonly time = messageTime;
  protected readonly closes = (iso: string | null) => windowClosesText(iso);
  protected readonly outStatus = OUT_STATUS;
  protected readonly replyMax = REPLY_MAX;

  protected readonly isStaff = computed(() => !!this.tenant.current() && this.tenant.current()?.role !== 'client');

  /** Telefone (E.164) da conversa aberta. */
  readonly selected = signal<string | null>(null);
  readonly thread = httpResource<ApiEnvelope<InboxThread>>(() => {
    const phone = this.selected();
    const tenantId = this.tenant.currentId();
    return phone && tenantId ? { url: API.inboxThread(phone), headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });
  protected readonly threadData = computed(() => (this.thread.hasValue() ? this.thread.value().data : null));
  protected readonly groups = computed(() => groupByDay(this.threadData()?.messages ?? []));

  readonly draft = signal('');
  readonly replyError = signal<string | null>(null);
  readonly sending = signal(false);

  /** A simulação só existe no modo demonstração; o modo vem junto com a lista, para toda a equipe. */
  protected readonly sandbox = computed(() => this.store.mode() === 'sandbox');
  readonly simulating = signal(false);
  readonly simPhone = signal('');
  readonly simText = signal('');
  readonly simError = signal<string | null>(null);
  readonly simBusy = signal(false);

  constructor() {
    // Lista (e a conversa aberta) atualizadas a cada 15 s.
    pollWhile(
      () => this.isStaff(),
      () => {
        this.store.reload();
        if (this.selected()) this.thread.reload();
      },
      INBOX_POLL_MS,
    );

    // Abriu a conversa: o servidor já marcou como lidas; o contador acompanha.
    effect(() => {
      const t = this.threadData();
      if (t) untracked(() => this.store.markRead(t.phone));
    });
  }

  protected initials(c: InboxConversation): string {
    const name = c.contact?.name?.trim();
    if (!name) return '#';
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }

  open(c: InboxConversation): void {
    if (this.selected() !== c.phone) {
      this.draft.set('');
      this.replyError.set(null);
    }
    this.selected.set(c.phone);
  }

  /** Enter envia; Shift+Enter quebra a linha. */
  protected onEnter(event: Event): void {
    if ((event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    void this.send();
  }

  async send(): Promise<void> {
    const phone = this.selected();
    const text = this.draft().trim();
    const t = this.threadData();
    if (!phone || !text || !t?.window_open || this.sending()) return;

    this.sending.set(true);
    try {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<InboxMessage>>(API.inboxReply(phone), { text }));
      this.draft.set('');
      this.thread.update((current) =>
        current && current.data.phone === phone ? { data: { ...current.data, messages: [...current.data.messages, res.data] } } : current,
      );
      this.store.reload();
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) {
        this.replyError.set(fields['text'] ?? Object.values(fields)[0] ?? 'Não foi possível enviar.');
        this.thread.reload(); // a janela pode ter fechado
      } else {
        const status = error instanceof HttpErrorResponse ? error.status : null;
        if (status === 429) this.replyError.set('Muitas mensagens seguidas. Espere um pouco e tente de novo.');
        else if (status !== 403 && status !== 0 && (status ?? 500) < 500) this.replyError.set('Não foi possível enviar.');
      }
    } finally {
      this.sending.set(false);
    }
  }

  async simulate(): Promise<void> {
    if (this.simBusy()) return;
    const phone = normalizePhone(this.simPhone());
    const text = this.simText().trim();
    if (!phone) {
      this.simError.set('Informe o telefone com DDD (10 a 15 dígitos, com o código do país).');
      return;
    }
    if (!text) {
      this.simError.set('Escreva a mensagem do cliente.');
      return;
    }

    this.simBusy.set(true);
    try {
      await firstValueFrom(this.http.post(API.inboxSimulate, { phone, text }));
      this.simText.set('');
      this.toast.success('Mensagem simulada', { message: 'Ela entrou como resposta do cliente.' });
      this.store.reload();
      if (this.selected() === phone) this.thread.reload();
      else this.selected.set(phone);
    } catch (error) {
      // 422 com campos (telefone, texto) ou só com a mensagem (fora do modo demonstração).
      const fields = extractFieldErrors(error) ?? {};
      this.simError.set(fields['phone'] ?? fields['text'] ?? validationMessage(error) ?? 'Não foi possível simular.');
    } finally {
      this.simBusy.set(false);
    }
  }
}
