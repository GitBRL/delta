import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsButton } from 'design-system';
import { ActionFeedback, ActionStatus, PlanAction } from '../../core/api/api.types';
import { ACTION_COLUMNS, ActionsApi, dueText, groupActions, measuringText, outcomeText } from './actions';

/**
 * Quadro do plano de ação: A fazer, Em andamento, Aplicadas e Descartadas.
 * Mover é por botões (claros no teclado e no celular). Descartar pede o motivo; nas aplicadas,
 * o Delta mostra a medição ("resultado em X dias") e depois o resultado, com feedback útil/não útil.
 */
@Component({
  selector: 'app-action-board',
  imports: [DsButton, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="board">
      @for (col of columns; track col.status) {
        <section class="column" [attr.data-column]="col.status" [attr.aria-label]="col.label">
          <h3 class="col-title">
            {{ col.label }}
            <span class="count">{{ groups()[col.status].length }}</span>
          </h3>
          @for (a of groups()[col.status]; track a.id) {
            <article class="card ds-glass" [attr.data-action]="a.id" animate.enter="ds-enter-fade-up">
              @if (showProject() && a.project) {
                <a class="project" [routerLink]="['/projetos', a.project.id]">{{ a.project.name }}</a>
              }
              <h4 class="m-0 text-subhead font-semibold">{{ a.title }}</h4>
              @if (a.suggestion) {
                <p class="m-0 text-footnote text-fg-muted">{{ a.suggestion }}</p>
              }
              <p class="meta">
                @if (a.assignee?.name) {
                  <span>{{ a.assignee?.name }}</span>
                }
                @if (due(a); as d) {
                  <span [class.late]="d.late && a.status !== 'done' && a.status !== 'dismissed'">{{ d.text }}</span>
                }
              </p>

              @if (a.status === 'done') {
                @if (measuring(a); as m) {
                  <p class="measure" role="status">{{ m }}</p>
                } @else if (outcome(a); as o) {
                  <p class="outcome" [attr.data-improved]="a.outcome?.improved">{{ o }}</p>
                }
                @if (canEdit()) {
                  <div class="feedback" role="group" aria-label="Esta sugestão foi útil?">
                    <span class="text-caption text-fg-muted">Foi útil?</span>
                    <button type="button" class="chip" [class.on]="a.feedback === 'useful'" [attr.aria-pressed]="a.feedback === 'useful'" (click)="setFeedback(a, 'useful')">Sim</button>
                    <button type="button" class="chip" [class.on]="a.feedback === 'not_useful'" [attr.aria-pressed]="a.feedback === 'not_useful'" (click)="setFeedback(a, 'not_useful')">Não</button>
                  </div>
                }
              }
              @if (a.status === 'dismissed' && a.dismissed_reason) {
                <p class="m-0 text-footnote text-fg-muted">Motivo: {{ a.dismissed_reason }}</p>
              }

              @if (canEdit()) {
                @if (dismissing() === a.id) {
                  <form class="dismiss" (submit)="$event.preventDefault(); confirmDismiss(a)">
                    <label class="field">
                      <span>Por que descartar? (melhora as próximas sugestões)</span>
                      <input name="dismiss_reason" type="text" maxlength="300" [value]="reason()" (input)="reason.set($any($event.target).value); reasonError.set(null)" />
                    </label>
                    @if (reasonError()) {
                      <small class="error" role="alert">{{ reasonError() }}</small>
                    }
                    <div class="buttons">
                      <button ds-button type="submit" size="sm" variant="secondary" [loading]="busy() === a.id">Descartar</button>
                      <button ds-button type="button" size="sm" variant="ghost" (click)="dismissing.set(null)">Manter</button>
                    </div>
                  </form>
                } @else if (confirmingRemove() === a.id) {
                  <div class="buttons">
                    <span class="text-footnote">Remover esta ação?</span>
                    <button ds-button size="sm" variant="ghost" [loading]="busy() === a.id" (click)="remove(a)">Remover</button>
                    <button ds-button size="sm" variant="ghost" (click)="confirmingRemove.set(null)">Manter</button>
                  </div>
                } @else {
                  <div class="buttons">
                    @switch (a.status) {
                      @case ('open') {
                        <button ds-button size="sm" variant="secondary" [disabled]="busy() === a.id" (click)="move(a, 'doing')">Começar</button>
                        <button ds-button size="sm" variant="ghost" [disabled]="busy() === a.id" (click)="move(a, 'done')">Aplicada</button>
                        <button ds-button size="sm" variant="ghost" (click)="startDismiss(a)">Descartar</button>
                      }
                      @case ('doing') {
                        <button ds-button size="sm" variant="secondary" [disabled]="busy() === a.id" (click)="move(a, 'done')">Aplicada</button>
                        <button ds-button size="sm" variant="ghost" [disabled]="busy() === a.id" (click)="move(a, 'open')">Voltar</button>
                        <button ds-button size="sm" variant="ghost" (click)="startDismiss(a)">Descartar</button>
                      }
                      @case ('dismissed') {
                        <button ds-button size="sm" variant="ghost" [disabled]="busy() === a.id" (click)="move(a, 'open')">Reabrir</button>
                      }
                    }
                    @if (a.status !== 'done') {
                      <button ds-button size="sm" variant="ghost" (click)="edit.emit(a)">Editar</button>
                    }
                    <button ds-button size="sm" variant="ghost" (click)="confirmingRemove.set(a.id)">Remover</button>
                  </div>
                }
              }
            </article>
          } @empty {
            <p class="empty">{{ col.empty }}</p>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .board {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--ds-space-3);
    }
    .column {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      min-width: 0;
      padding: var(--ds-space-2);
      border-radius: var(--ds-radius-lg);
      background: var(--ds-fill);
    }
    .col-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 0;
      padding: 4px 6px;
      font: var(--ds-text-footnote);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--ds-text-secondary);
    }
    .count {
      min-width: 22px;
      padding: 0 6px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-bg-elevated);
      text-align: center;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
    }
    .project {
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-accent);
      text-decoration: none;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0;
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
    }
    .late {
      color: var(--ds-status-critical);
      font-weight: 600;
    }
    .measure {
      margin: 0;
      font: var(--ds-text-footnote);
      color: var(--ds-status-opportunity);
    }
    .outcome {
      margin: 0;
      padding: 6px 10px;
      border-radius: var(--ds-radius-sm);
      font: var(--ds-text-footnote);
      font-weight: 600;
      background: var(--ds-bg-elevated);
    }
    .outcome[data-improved='true'] {
      color: var(--ds-status-healthy);
    }
    .outcome[data-improved='false'] {
      color: var(--ds-status-critical);
    }
    .feedback,
    .buttons {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .chip {
      padding: 2px 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-full);
      background: transparent;
      color: var(--ds-text);
      font: var(--ds-text-caption);
      cursor: pointer;
    }
    .chip.on {
      border-color: var(--ds-accent);
      background: var(--ds-accent);
      color: white;
    }
    .dismiss {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
    }
    .field input {
      height: 32px;
      padding: 0 8px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
    }
    .error {
      color: var(--ds-status-critical);
      font: var(--ds-text-caption);
    }
    .empty {
      margin: 0;
      padding: var(--ds-space-2);
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
  `,
})
export class ActionBoard {
  readonly actions = input.required<readonly PlanAction[]>();
  readonly canEdit = input(false);
  /** Quadro da agência inteira: mostra o projeto de cada ação. */
  readonly showProject = input(false);
  readonly labels = input<Readonly<Record<string, string>>>({});

  readonly changed = output<PlanAction>();
  readonly removed = output<string>();
  readonly edit = output<PlanAction>();

  private readonly api = inject(ActionsApi);

  protected readonly columns = ACTION_COLUMNS;
  protected readonly groups = computed(() => groupActions(this.actions()));

  readonly busy = signal<string | null>(null);
  readonly dismissing = signal<string | null>(null);
  readonly confirmingRemove = signal<string | null>(null);
  readonly reason = signal('');
  readonly reasonError = signal<string | null>(null);

  protected measuring(a: PlanAction): string | null {
    return measuringText(a);
  }

  protected outcome(a: PlanAction): string | null {
    return outcomeText(a, this.labels());
  }

  protected due(a: PlanAction) {
    return dueText(a.due_on);
  }

  async move(a: PlanAction, status: ActionStatus): Promise<void> {
    await this.apply(a, { status });
  }

  startDismiss(a: PlanAction): void {
    this.dismissing.set(a.id);
    this.reason.set('');
    this.reasonError.set(null);
  }

  async confirmDismiss(a: PlanAction): Promise<void> {
    const reason = this.reason().trim();
    if (!reason) {
      this.reasonError.set('Conte por que a sugestão foi descartada.');
      return;
    }
    const ok = await this.apply(a, { status: 'dismissed', dismissed_reason: reason });
    if (ok) this.dismissing.set(null);
  }

  async setFeedback(a: PlanAction, feedback: ActionFeedback): Promise<void> {
    await this.apply(a, { feedback: a.feedback === feedback ? null : feedback });
  }

  async remove(a: PlanAction): Promise<void> {
    this.busy.set(a.id);
    const ok = await this.api.remove(a.id);
    this.busy.set(null);
    this.confirmingRemove.set(null);
    if (ok) this.removed.emit(a.id);
  }

  private async apply(a: PlanAction, body: Parameters<ActionsApi['patch']>[1]): Promise<boolean> {
    this.busy.set(a.id);
    const result = await this.api.patch(a.id, body);
    this.busy.set(null);
    if (result.ok) {
      this.changed.emit(result.data);
      return true;
    }
    if (result.fields?.['dismissed_reason']) this.reasonError.set(result.fields['dismissed_reason']);
    return false;
  }
}
