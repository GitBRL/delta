import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DsButton, DsSkeleton } from 'design-system';
import { API, ApiEnvelope, PlanAction } from '../../core/api/api.types';
import { TenantService } from '../../core/tenant/tenant.service';
import { ActionBoard } from './action-board';
import { ActionForm } from './action-form';

/** /acoes — o plano de ação da agência inteira, com filtro por projeto. */
@Component({
  selector: 'app-actions-page',
  imports: [ActionBoard, ActionForm, DsButton, DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-6">
      <h1 class="m-0 text-large-title font-bold tracking-tight">Ações</h1>
      <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
        O que a equipe está fazendo por cada cliente. Ao marcar uma ação como aplicada, o Delta compara a métrica
        nos 14 dias antes e depois e mostra se funcionou.
      </p>
    </header>

    @if (projects().length > 1) {
      <label class="filter">
        <span>Projeto</span>
        <select name="actions_project" (change)="projectFilter.set($any($event.target).value)">
          <option value="">Todos os projetos</option>
          @for (p of projects(); track p.id) {
            <option [value]="p.id" [selected]="p.id === projectFilter()">{{ p.name }}</option>
          }
        </select>
      </label>
    }

    @if (editing(); as a) {
      <div class="mb-4">
        <app-action-form [action]="a" (saved)="replace($event); editing.set(null)" (cancelled)="editing.set(null)" />
      </div>
    }

    @if (actions.isLoading() && !actions.hasValue()) {
      <ds-skeleton height="200px" radius="var(--ds-radius-lg)" />
    } @else if (actions.error() && !actions.hasValue()) {
      <div class="state ds-glass" role="alert">
        <p class="m-0 text-headline">Não foi possível carregar as ações.</p>
        <button ds-button variant="secondary" size="sm" (click)="actions.reload()">Tentar de novo</button>
      </div>
    } @else if (list().length === 0) {
      <div class="state ds-glass">
        <p class="m-0 text-headline">Nenhuma ação ainda</p>
        <p class="m-0 text-footnote text-fg-muted">Abra um projeto e use "Criar ação" nos sinais do radar de atenção.</p>
      </div>
    } @else {
      <app-action-board
        [actions]="filtered()"
        [canEdit]="canEdit()"
        [showProject]="true"
        (changed)="replace($event)"
        (removed)="drop($event)"
        (edit)="editing.set($event)"
      />
    }
  `,
  styles: `
    .filter {
      display: inline-flex;
      align-items: center;
      gap: var(--ds-space-2);
      margin-bottom: var(--ds-space-4);
      font: var(--ds-text-footnote);
      color: var(--ds-text-secondary);
    }
    .filter select {
      height: 34px;
      padding: 0 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
    }
    .state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--ds-space-2);
      padding: var(--ds-space-10) var(--ds-space-6);
      border-radius: var(--ds-radius-xl);
      text-align: center;
    }
  `,
})
export class ActionsPage {
  private readonly tenant = inject(TenantService);

  readonly actions = httpResource<ApiEnvelope<PlanAction[]>>(() => (this.tenant.currentId() ? API.actions : undefined));
  protected readonly list = computed(() => (this.actions.hasValue() ? this.actions.value().data : []));
  protected readonly canEdit = computed(() => this.tenant.current()?.role !== 'client');

  readonly projectFilter = signal('');
  readonly editing = signal<PlanAction | null>(null);

  protected readonly projects = computed(() => {
    const seen = new Map<string, string>();
    for (const a of this.list()) if (a.project) seen.set(a.project.id, a.project.name);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  });
  protected readonly filtered = computed(() => {
    const id = this.projectFilter();
    return id ? this.list().filter((a) => a.project?.id === id) : this.list();
  });

  replace(action: PlanAction): void {
    this.actions.update((current) => ({ data: (current?.data ?? []).map((a) => (a.id === action.id ? action : a)) }));
  }

  drop(id: string): void {
    this.actions.update((current) => ({ data: (current?.data ?? []).filter((a) => a.id !== id) }));
  }
}
