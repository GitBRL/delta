import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DsButton, DsIcon, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, TENANT_HEADER, TimelineEvent, TimelineEventBody } from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors } from '../../core/forms/server-errors';
import { toIsoDate } from '../../core/metrics/period';
import { TenantService } from '../../core/tenant/tenant.service';
import { daysAgo, eventDate, timelineMeta } from './timeline';

/**
 * Linha do tempo do projeto: marcos manuais (campanha no ar, troca de criativos) e automáticos
 * (relatório publicado e enviado, metas). Os marcos também aparecem no gráfico do projeto, por
 * isso a página do projeto busca os eventos (uma vez) e passa para cá.
 */
@Component({
  selector: 'app-project-timeline',
  imports: [DsButton, DsIcon, DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="timeline-title">
      <div class="head">
        <h2 id="timeline-title" class="m-0 text-headline">Linha do tempo</h2>
        @if (canEdit() && !adding()) {
          <button ds-button variant="secondary" size="sm" (click)="open()">Adicionar marco</button>
        }
      </div>

      @if (adding()) {
        <form class="form" aria-label="Novo marco" (submit)="$event.preventDefault(); save()">
          <label class="field">
            <span>O que aconteceu</span>
            <input
              type="text"
              name="timeline_title"
              maxlength="160"
              placeholder="Ex.: Campanha de Black Friday no ar"
              [value]="title()"
              (input)="title.set($any($event.target).value); clearError('title')"
              [attr.aria-invalid]="!!errors()['title']"
            />
            @if (errors()['title']) {
              <small class="error" role="alert">{{ errors()['title'] }}</small>
            }
          </label>
          <div class="row">
            <label class="field">
              <span>Data</span>
              <input type="date" name="timeline_date" [value]="date()" (input)="date.set($any($event.target).value); clearError('occurred_on')" />
              @if (errors()['occurred_on']) {
                <small class="error" role="alert">{{ errors()['occurred_on'] }}</small>
              }
            </label>
            <label class="field grow">
              <span>Detalhes (opcional)</span>
              <input type="text" name="timeline_description" maxlength="1000" [value]="description()" (input)="description.set($any($event.target).value)" />
            </label>
          </div>
          <div class="actions">
            <button ds-button type="submit" size="sm" [loading]="saving()">Adicionar</button>
            <button ds-button type="button" variant="ghost" size="sm" (click)="adding.set(false)">Cancelar</button>
          </div>
        </form>
      }

      @if (loading() && events() === null) {
        <ds-skeleton width="80%" />
        <ds-skeleton width="60%" />
      } @else if (list().length === 0) {
        <p class="m-0 text-footnote text-fg-muted">
          Nada por aqui ainda. Publicações, envios e metas entram sozinhos; marque também campanhas e mudanças importantes.
        </p>
      } @else {
        <ol class="timeline">
          @for (event of list(); track event.id) {
            @let meta = typeMeta(event.type);
            <li class="item" [attr.data-type]="event.type" [style.--tl-color]="'var(' + meta.color + ')'">
              <span class="icon" aria-hidden="true"><svg [dsIcon]="meta.icon" [size]="14"></svg></span>
              <div class="body">
                <p class="title">{{ event.title }}</p>
                @if (event.description) {
                  <p class="desc">{{ event.description }}</p>
                }
                <p class="when">
                  <span class="kind">{{ meta.label }}</span> ·
                  <time [attr.datetime]="event.occurred_on">{{ eventDate(event.occurred_on) }}</time> ({{ daysAgo(event.occurred_on) }})
                  @if (event.created_by) {
                    · {{ event.created_by }}
                  }
                </p>
              </div>
              @if (canEdit() && event.manual) {
                @if (confirming() === event.id) {
                  <span class="confirm">
                    <button ds-button variant="ghost" size="sm" [loading]="removing() === event.id" (click)="remove(event)">Remover</button>
                    <button ds-button variant="ghost" size="sm" (click)="confirming.set(null)">Manter</button>
                  </span>
                } @else {
                  <button type="button" class="x" (click)="confirming.set(event.id)" [attr.aria-label]="'Remover marco ' + event.title">
                    <svg dsIcon="x" [size]="14"></svg>
                  </button>
                }
              }
            </li>
          }
        </ol>
      }
    </section>
  `,
  styles: `
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-2);
      margin-bottom: var(--ds-space-3);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      margin-bottom: var(--ds-space-4);
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-3);
    }
    .grow {
      flex: 1;
      min-width: 180px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
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
    .error {
      color: var(--ds-status-critical);
      font-weight: 500;
    }
    .actions,
    .confirm {
      display: flex;
      gap: var(--ds-space-2);
    }
    .timeline {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      margin: 0;
      padding: 0 0 0 4px;
      list-style: none;
    }
    .timeline::before {
      content: '';
      position: absolute;
      top: 6px;
      bottom: 6px;
      left: 17px;
      width: 2px;
      background: var(--ds-separator);
    }
    .item {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: var(--ds-space-3);
    }
    .icon {
      position: relative;
      z-index: 1;
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--ds-bg-elevated);
      border: 2px solid var(--tl-color);
      color: var(--tl-color);
    }
    .body {
      flex: 1;
      min-width: 0;
    }
    .title {
      margin: 3px 0 0;
      font: var(--ds-text-subhead);
      font-weight: 600;
    }
    .desc {
      margin: 2px 0 0;
      font: var(--ds-text-footnote);
      color: var(--ds-text-secondary);
    }
    .when {
      margin: 2px 0 0;
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
    .kind {
      color: var(--tl-color);
      font-weight: 600;
    }
    .x {
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--ds-text-tertiary);
      cursor: pointer;
    }
    .x:hover,
    .x:focus-visible {
      background: var(--ds-fill);
      color: var(--ds-text);
    }
  `,
})
export class ProjectTimeline {
  readonly projectId = input.required<string>();
  readonly canEdit = input(false);
  /** Eventos do projeto (nulo enquanto carrega). */
  readonly events = input<readonly TimelineEvent[] | null>(null);
  readonly loading = input(false);
  /** Um marco foi criado ou removido: a página recarrega os eventos (e os marcadores do gráfico). */
  readonly changed = output<void>();

  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  private readonly tenant = inject(TenantService);

  protected readonly typeMeta = timelineMeta;
  protected readonly eventDate = eventDate;
  protected readonly daysAgo = (iso: string) => daysAgo(iso);

  protected readonly list = computed(() => this.events() ?? []);

  readonly adding = signal(false);
  readonly title = signal('');
  readonly description = signal('');
  readonly date = signal(toIsoDate(new Date()));
  readonly errors = signal<FieldErrors>({});
  readonly saving = signal(false);
  readonly confirming = signal<string | null>(null);
  readonly removing = signal<string | null>(null);

  open(): void {
    this.title.set('');
    this.description.set('');
    this.date.set(toIsoDate(new Date()));
    this.errors.set({});
    this.adding.set(true);
  }

  protected clearError(field: string): void {
    if (!this.errors()[field]) return;
    this.errors.update((all) => {
      const next = { ...all };
      delete next[field];
      return next;
    });
  }

  async save(): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId || this.saving()) return;
    const title = this.title().trim();
    if (title.length < 2) {
      this.errors.set({ title: 'Descreva o marco (ex.: "Campanha de Black Friday no ar").' });
      return;
    }
    if (!this.date()) {
      this.errors.set({ occurred_on: 'Escolha a data.' });
      return;
    }

    const body: TimelineEventBody = { title, description: this.description().trim() || null, occurred_on: this.date() };
    this.saving.set(true);
    try {
      await firstValueFrom(this.http.post(API.projectTimeline(this.projectId()), body, { headers: { [TENANT_HEADER]: tenantId } }));
      this.toast.success('Marco adicionado');
      this.adding.set(false);
      this.changed.emit();
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) this.errors.set(fields);
      else if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
        this.toast.error('Não foi possível adicionar o marco');
      }
    } finally {
      this.saving.set(false);
    }
  }

  async remove(event: TimelineEvent): Promise<void> {
    const tenantId = this.tenant.currentId();
    if (!tenantId) return;
    this.removing.set(event.id);
    try {
      await firstValueFrom(this.http.delete(API.timelineEvent(event.id), { headers: { [TENANT_HEADER]: tenantId } }));
      this.confirming.set(null);
      this.changed.emit();
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 422) {
        this.toast.info('Marcos automáticos não podem ser removidos');
      }
    } finally {
      this.removing.set(null);
    }
  }
}
