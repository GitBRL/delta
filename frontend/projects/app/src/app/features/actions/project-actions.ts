import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { DsButton, DsSkeleton, DsToastService } from 'design-system';
import { API, ActionBody, ApiEnvelope, AttentionSignal, PlanAction } from '../../core/api/api.types';
import { TenantService } from '../../core/tenant/tenant.service';
import { ActionBoard } from './action-board';
import { ActionForm } from './action-form';
import { actionFromSignal } from './actions';

/** Plano de ação do projeto: quadro + criar/editar. "Criar ação" do radar abre o formulário pré-preenchido. */
@Component({
  selector: 'app-project-actions',
  imports: [ActionBoard, ActionForm, DsButton, DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="pactions-title">
      <div class="head">
        <div>
          <h2 id="pactions-title" class="m-0 text-headline">Plano de ação</h2>
          <p class="m-0 text-footnote text-fg-muted">Sugestões viram tarefas; aplicadas, o Delta mede o resultado em 14 dias.</p>
        </div>
        @if (canEdit() && !formOpen()) {
          <button ds-button variant="secondary" size="sm" (click)="openNew()">Nova ação</button>
        }
      </div>

      @if (formOpen()) {
        <app-action-form
          [projectId]="projectId()"
          [seed]="seed()"
          [action]="editing()"
          [labels]="labels()"
          [linkedProviders]="linkedProviders()"
          (saved)="onSaved($event)"
          (cancelled)="closeForm()"
        />
      }

      @if (actions.isLoading() && !actions.hasValue()) {
        <ds-skeleton height="120px" radius="var(--ds-radius-lg)" />
      } @else if (list().length === 0 && !formOpen()) {
        <p class="m-0 text-footnote text-fg-muted">
          Nenhuma ação ainda. {{ canEdit() ? 'Use "Criar ação" num sinal do radar ou crie uma aqui.' : '' }}
        </p>
      } @else if (list().length) {
        <app-action-board
          [actions]="list()"
          [canEdit]="canEdit()"
          [labels]="labels()"
          (changed)="replace($event)"
          (removed)="drop($event)"
          (edit)="openEdit($event)"
        />
      }
    </section>
  `,
  styles: `
    section {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--ds-space-2);
    }
  `,
})
export class ProjectActions {
  readonly projectId = input.required<string>();
  readonly canEdit = input(false);
  readonly labels = input<Readonly<Record<string, string>>>({});
  readonly linkedProviders = input<readonly string[]>([]);

  private readonly tenant = inject(TenantService);
  private readonly toast = inject(DsToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly actions = httpResource<ApiEnvelope<PlanAction[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId ? API.projectActions(this.projectId()) : undefined;
  });
  protected readonly list = computed(() => (this.actions.hasValue() ? this.actions.value().data : []));

  readonly formOpen = signal(false);
  readonly seed = signal<ActionBody | null>(null);
  readonly editing = signal<PlanAction | null>(null);

  openNew(): void {
    this.seed.set(null);
    this.editing.set(null);
    this.formOpen.set(true);
  }

  /** Vindo de um sinal do semáforo: formulário pré-preenchido e rolagem até a seção. */
  createFrom(signal: AttentionSignal): void {
    this.editing.set(null);
    this.seed.set(actionFromSignal(signal));
    this.formOpen.set(true);
    const el = this.host.nativeElement;
    if (typeof el.scrollIntoView === 'function') {
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  }

  openEdit(action: PlanAction): void {
    this.seed.set(null);
    this.editing.set(action);
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.seed.set(null);
    this.editing.set(null);
  }

  onSaved(action: PlanAction): void {
    const isNew = !this.list().some((a) => a.id === action.id);
    this.replace(action);
    this.closeForm();
    this.toast.success(isNew ? 'Ação criada' : 'Ação atualizada');
  }

  replace(action: PlanAction): void {
    this.actions.update((current) => {
      const data = current?.data ?? [];
      const exists = data.some((a) => a.id === action.id);
      return { data: exists ? data.map((a) => (a.id === action.id ? action : a)) : [action, ...data] };
    });
  }

  drop(id: string): void {
    this.actions.update((current) => ({ data: (current?.data ?? []).filter((a) => a.id !== id) }));
  }
}
