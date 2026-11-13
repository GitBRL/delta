import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideSparkles } from '@lucide/angular';
import { DsButton, DsSkeleton } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, AiReply, ApiEnvelope, TENANT_HEADER } from '../../core/api/api.types';
import { TenantService } from '../../core/tenant/tenant.service';
import { AiReplyView } from './ai-reply';
import { ASK_EXAMPLES, ASK_LIMITS, AiStatusStore, aiErrorMessage, aiReady, aiUnavailableText } from './ai';

export interface CopilotTurn {
  id: number;
  question: string;
  reply: AiReply | null;
  error: string | null;
  pending: boolean;
}

/**
 * "Pergunte ao copiloto" no projeto (equipe): respostas com os números dos últimos 30 dias.
 * O histórico vale só nesta visita à página (nada é guardado).
 */
@Component({
  selector: 'app-project-copilot',
  imports: [RouterLink, DsButton, DsSkeleton, AiReplyView, LucideSparkles],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <span class="badge" aria-hidden="true"><svg lucideSparkles [size]="16"></svg></span>
      <div>
        <h2 id="copilot-title" class="m-0 text-headline">Pergunte ao copiloto</h2>
        <p class="m-0 text-footnote text-fg-muted">Respostas com os números dos últimos 30 dias. São sugestões: confira antes de agir.</p>
      </div>
    </header>

    @if (store.loading()) {
      <div class="flex flex-col gap-2"><ds-skeleton width="70%" /><ds-skeleton width="40%" /></div>
    } @else if (store.failed()) {
      <p class="m-0 text-footnote text-fg-muted" role="alert">
        Não foi possível conferir o copiloto.
        <button type="button" class="link" (click)="store.reload()">Tentar de novo</button>
      </p>
    } @else if (store.status(); as status) {
      @if (!ready()) {
        <div class="empty" data-testid="copilot-empty">
          <p class="m-0 text-subhead">{{ unavailable(status) }}</p>
          @if (tenant.isAdmin()) {
            <a class="link" routerLink="/configuracoes/ia">Configurar em Configurações › IA</a>
          } @else {
            <p class="m-0 text-footnote text-fg-muted">Peça a um dono ou administrador da agência para ativar.</p>
          }
        </div>
      } @else {
        @if (turns().length) {
          <ol class="turns" aria-live="polite">
            @for (turn of turns(); track turn.id) {
              <li class="turn">
                <p class="question"><span class="ds-visually-hidden">Pergunta: </span>{{ turn.question }}</p>
                @if (turn.pending) {
                  <div class="answer" role="status" aria-busy="true">
                    <p class="m-0 text-footnote text-fg-muted">Analisando os números…</p>
                    <ds-skeleton width="90%" />
                    <ds-skeleton width="65%" />
                  </div>
                } @else if (turn.error) {
                  <p class="answer error" role="alert">{{ turn.error }}</p>
                } @else if (turn.reply) {
                  <app-ai-reply class="answer" [reply]="turn.reply" />
                }
              </li>
            }
          </ol>
        } @else {
          <ul class="examples" aria-label="Exemplos de pergunta">
            @for (example of examples; track example) {
              <li><button type="button" class="chip" (click)="question.set(example)">{{ example }}</button></li>
            }
          </ul>
        }

        <form class="ask" (submit)="$event.preventDefault(); ask()" novalidate>
          <label class="ds-visually-hidden" for="copilot-question">Sua pergunta</label>
          <textarea
            id="copilot-question"
            name="question"
            rows="2"
            [attr.maxlength]="limits.max"
            placeholder="Ex.: por que o CPA subiu?"
            [value]="question()"
            (input)="question.set($any($event.target).value); questionError.set(null)"
            (keydown.enter)="onEnter($event)"
            [attr.aria-invalid]="!!questionError()"
            [attr.aria-describedby]="questionError() ? 'copilot-error' : 'copilot-count'"
          ></textarea>
          <div class="ask-foot">
            @if (questionError()) {
              <small id="copilot-error" class="error" role="alert">{{ questionError() }}</small>
            } @else {
              <small id="copilot-count" class="count">{{ question().length }}/{{ limits.max }}</small>
            }
            <button ds-button type="submit" size="sm" [loading]="busy()">Perguntar</button>
          </div>
        </form>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    .head {
      display: flex;
      align-items: flex-start;
      gap: var(--ds-space-3);
    }
    .badge {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 10px;
      background: color-mix(in oklch, var(--ds-accent) 14%, transparent);
      color: var(--ds-accent);
    }
    .empty {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
    }
    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--ds-accent);
      font: var(--ds-text-footnote);
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
    }
    .turns {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .turn {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
    }
    .question {
      align-self: flex-end;
      max-width: 85%;
      margin: 0;
      padding: 8px 12px;
      border-radius: 14px 14px 4px 14px;
      background: color-mix(in oklch, var(--ds-accent) 14%, transparent);
      font: var(--ds-text-subhead);
      overflow-wrap: anywhere;
    }
    .answer {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin: 0;
    }
    .examples {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .chip {
      padding: 6px 12px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-full);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
      text-align: left;
      cursor: pointer;
    }
    .chip:focus-visible {
      outline: 2px solid var(--ds-accent);
      outline-offset: 2px;
    }
    .ask {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
    }
    .ask textarea {
      width: 100%;
      min-height: 64px;
      padding: 10px 12px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-subhead);
      resize: vertical;
    }
    .ask textarea[aria-invalid='true'] {
      border-color: var(--ds-status-critical);
    }
    .ask-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-2);
    }
    .count {
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
    .error {
      color: var(--ds-status-critical);
      font: var(--ds-text-footnote);
    }
  `,
})
export class ProjectCopilot {
  readonly projectId = input.required<string>();

  private readonly http = inject(HttpClient);
  protected readonly tenant = inject(TenantService);
  protected readonly store = inject(AiStatusStore);

  protected readonly examples = ASK_EXAMPLES;
  protected readonly limits = ASK_LIMITS;
  protected readonly ready = () => aiReady(this.store.status());
  protected readonly unavailable = aiUnavailableText;

  readonly question = signal('');
  readonly questionError = signal<string | null>(null);
  readonly turns = signal<CopilotTurn[]>([]);
  readonly busy = signal(false);
  private seq = 0;

  /** Enter envia; Shift+Enter quebra a linha. */
  protected onEnter(event: Event): void {
    if ((event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    void this.ask();
  }

  async ask(): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId || this.busy()) return;

    const question = this.question().trim();
    if (question.length < ASK_LIMITS.min) {
      this.questionError.set('Escreva a pergunta (pelo menos 3 letras).');
      return;
    }
    if (question.length > ASK_LIMITS.max) {
      this.questionError.set(`Use no máximo ${ASK_LIMITS.max} caracteres.`);
      return;
    }

    const id = ++this.seq;
    this.turns.update((all) => [...all, { id, question, reply: null, error: null, pending: true }]);
    this.question.set('');
    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiEnvelope<AiReply>>(API.projectAiAsk(this.projectId()), { question }, {
          headers: { [TENANT_HEADER]: tenantId },
        }),
      );
      this.patchTurn(id, { reply: res.data, pending: false });
    } catch (error) {
      this.patchTurn(id, { error: aiErrorMessage(error), pending: false });
    } finally {
      this.busy.set(false);
    }
  }

  private patchTurn(id: number, patch: Partial<CopilotTurn>): void {
    this.turns.update((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
}
