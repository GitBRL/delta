import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucidePencil, LucidePlug } from '@lucide/angular';
import { DsButton } from 'design-system';
import { Account, Connection } from '../../core/api/api.types';
import { ACCOUNT_KIND_LABEL } from '../integrations/integration-labels';
import { ProviderIcon } from '../integrations/provider-icon';

/**
 * Contas vinculadas ao projeto. Edição por multi-seleção das contas de todas as conexões da agência;
 * quem salva (PUT) é a tela, via `save`.
 */
@Component({
  selector: 'app-linked-accounts',
  imports: [RouterLink, DsButton, ProviderIcon, LucidePencil, LucidePlug],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h2 class="m-0 text-headline">Contas vinculadas</h2>
      @if (canEdit() && hasConnections() && !editing()) {
        <button ds-button variant="ghost" size="sm" (click)="editing.set(true)">
          <svg lucidePencil [size]="14"></svg>
          Editar
        </button>
      }
    </div>

    @if (!hasConnections()) {
      <div class="empty">
        <svg lucidePlug [size]="28" class="text-fg-subtle"></svg>
        <p class="m-0 text-subhead font-semibold">Nenhuma conta conectada na agência</p>
        <p class="m-0 text-footnote text-fg-muted">Conecte uma plataforma para vincular contas a este projeto.</p>
        <a ds-button size="sm" routerLink="/integracoes">Ir para Integrações</a>
      </div>
    } @else if (editing()) {
      <form (submit)="submit($event)">
        @for (connection of connections(); track connection.id) {
          <fieldset class="group">
            <legend>{{ providerName()(connection.provider) }} · {{ connection.label }}</legend>
            @for (account of connection.accounts; track account.id) {
              <label class="option">
                <input
                  type="checkbox"
                  [checked]="selection().has(account.id)"
                  (change)="toggle(account.id)"
                />
                <span class="font-semibold">{{ account.name }}</span>
                <span class="text-fg-muted">{{ kindLabel[account.kind] }}</span>
              </label>
            } @empty {
              <p class="m-0 text-footnote text-fg-muted">Sem contas nesta conexão.</p>
            }
          </fieldset>
        }
        <div class="actions">
          <button ds-button size="sm" type="submit" [loading]="saving()" [disabled]="saving()">Salvar</button>
          <button ds-button size="sm" variant="secondary" type="button" [disabled]="saving()" (click)="cancel()">
            Cancelar
          </button>
        </div>
      </form>
    } @else if (linked().length === 0) {
      <p class="m-0 text-footnote text-fg-muted">
        Nenhuma conta vinculada. {{ canEdit() ? 'Use "Editar" para escolher as contas deste cliente.' : '' }}
      </p>
    } @else {
      <ul class="chips">
        @for (account of linked(); track account.id) {
          <li class="chip">
            <app-provider-icon [provider]="account.provider" [size]="14" />
            {{ account.name }}
          </li>
        }
      </ul>
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
      gap: var(--ds-space-2);
    }
    .empty {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--ds-space-2);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-accent-soft);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
    }
    .group {
      margin: 0 0 var(--ds-space-3);
      padding: 0;
      border: 0;
    }
    legend {
      margin-bottom: var(--ds-space-1);
      font: var(--ds-text-footnote);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .option {
      display: flex;
      align-items: center;
      gap: var(--ds-space-2);
      padding: 6px 0;
      font: var(--ds-text-footnote);
      cursor: pointer;
    }
    .option input {
      width: 16px;
      height: 16px;
      accent-color: var(--ds-accent);
    }
    .actions {
      display: flex;
      gap: var(--ds-space-2);
    }
  `,
})
export class LinkedAccounts {
  readonly connections = input.required<readonly Connection[]>();
  readonly linked = input.required<readonly Account[]>();
  readonly providerName = input<(key: string) => string>((key) => key);
  readonly canEdit = input(true);
  readonly saving = input(false);

  readonly save = output<string[]>();

  protected readonly kindLabel = ACCOUNT_KIND_LABEL;
  protected readonly hasConnections = computed(() => this.connections().length > 0);

  /** Modo de edição; sai sozinho quando o conjunto vinculado muda (salvo com sucesso). */
  readonly editing = linkedSignal<readonly Account[], boolean>({
    source: this.linked,
    computation: () => false,
  });

  /** Seleção em edição; recomeça a partir do que está vinculado. */
  readonly selection = linkedSignal<ReadonlySet<string>>(() => new Set(this.linked().map((a) => a.id)));

  protected toggle(id: string): void {
    this.selection.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.save.emit([...this.selection()]);
  }

  protected cancel(): void {
    this.selection.set(new Set(this.linked().map((a) => a.id)));
    this.editing.set(false);
  }
}
