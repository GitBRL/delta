import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsButton, DsSkeleton } from 'design-system';
import { API, ApiEnvelope, Goal, TENANT_HEADER } from '../../core/api/api.types';
import { TenantService } from '../../core/tenant/tenant.service';
import { GoalCard } from './goal-card';
import { groupGoals } from './goals';

/**
 * Metas (Controle): todas as metas da agência, agrupadas do que pede ação ao que já foi
 * batido. O cliente vê só as dos projetos dele. Rota: /metas
 */
@Component({
  selector: 'app-goals-page',
  imports: [RouterLink, DsButton, DsSkeleton, GoalCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="m-0 text-footnote font-semibold uppercase tracking-wider text-fg-subtle">{{ tenant.current()?.name }}</p>
        <h1 class="m-0 mt-1 text-large-title font-bold tracking-tight">Metas</h1>
        <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
          O andamento das metas de todos os projetos, com o ritmo esperado até hoje e a projeção do
          período. A equipe recebe um e-mail quando alguma sai do ritmo.
        </p>
      </div>
      @if (projects().length > 1) {
        <label class="filter">
          <span>Projeto</span>
          <select name="goal_project" (change)="projectFilter.set($any($event.target).value)">
            <option value="">Todos os projetos</option>
            @for (p of projects(); track p.id) {
              <option [value]="p.id" [selected]="p.id === projectFilter()">{{ p.name }}</option>
            }
          </select>
        </label>
      }
    </header>

    @if (goals.isLoading() && !goals.hasValue()) {
      <div class="grid" aria-busy="true">
        @for (i of [1, 2, 3]; track i) {
          <ds-skeleton height="140px" radius="var(--ds-radius-lg)" />
        }
      </div>
    } @else if (goals.error()) {
      <div class="state ds-glass" role="alert">
        <p class="m-0 text-headline">Não foi possível carregar as metas.</p>
        <button ds-button variant="secondary" size="sm" (click)="goals.reload()">Tentar de novo</button>
      </div>
    } @else if (list().length === 0) {
      <div class="state ds-glass">
        <p class="m-0 text-headline">Nenhuma meta ainda</p>
        <p class="m-0 text-footnote text-fg-muted">
          Crie metas na página de cada projeto: "200 leads no mês", "CPA até R$ 50", "ROAS de pelo menos 3".
        </p>
        <a ds-button variant="secondary" size="sm" routerLink="/projetos">Ir para os projetos</a>
      </div>
    } @else {
      <div class="summary" role="status">
        @for (group of groups(); track group.status) {
          <a class="pill" [attr.data-status]="group.status" [href]="'#grupo-' + group.status">{{ group.label }} · {{ group.goals.length }}</a>
        }
      </div>
      @for (group of groups(); track group.status) {
        <section class="group" [id]="'grupo-' + group.status" [attr.aria-labelledby]="'g-' + group.status">
          <h2 class="m-0 mb-3 text-title-3 font-semibold" [id]="'g-' + group.status">{{ group.label }}</h2>
          <div class="grid">
            @for (goal of group.goals; track goal.id) {
              <app-goal-card [goal]="goal" [showProject]="true" />
            }
          </div>
        </section>
      }
    }
  `,
  styles: `
    .filter {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .filter select {
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: var(--ds-space-3);
    }
    .group {
      margin-bottom: var(--ds-space-8);
    }
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-2);
      margin-bottom: var(--ds-space-6);
    }
    .pill {
      padding: 4px 12px;
      border-radius: 999px;
      background: var(--ds-fill);
      font: var(--ds-text-footnote);
      font-weight: 600;
      color: var(--ds-text);
      text-decoration: none;
    }
    .pill[data-status='off_track'] {
      color: var(--ds-status-critical);
    }
    .pill[data-status='at_risk'] {
      color: var(--ds-status-attention);
    }
    .pill[data-status='on_track'],
    .pill[data-status='achieved'] {
      color: var(--ds-status-healthy);
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
export class GoalsPage {
  protected readonly tenant = inject(TenantService);

  protected readonly goals = httpResource<ApiEnvelope<Goal[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url: API.goals, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });

  readonly projectFilter = signal('');
  private readonly all = computed(() => (this.goals.hasValue() ? this.goals.value().data : []));
  protected readonly projects = computed(() => {
    const seen = new Map<string, string>();
    for (const g of this.all()) seen.set(g.project.id, g.project.name);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  });
  protected readonly list = computed(() => {
    const filter = this.projectFilter();
    return filter ? this.all().filter((g) => g.project.id === filter) : this.all();
  });
  readonly groups = computed(() => groupGoals(this.list()));
}
