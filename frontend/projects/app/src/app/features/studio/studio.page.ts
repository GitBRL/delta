import { HttpClient, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DsButton, DsGlassCard, DsIcon, DsSkeleton, DsTextField } from 'design-system';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ApiEnvelope,
  Presentation,
  PresentationFormat,
  PresentationSummary,
  Project,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { isPlanLimitError } from '../../core/billing/plan-limit';
import { relativeTime } from '../../core/format/relative-time';
import { FieldErrors, extractFieldErrors } from '../../core/forms/server-errors';
import { COMPARE_OPTIONS, PERIOD_PRESETS } from '../../core/metrics/period';
import { TenantService } from '../../core/tenant/tenant.service';
import {
  BRIEF_LIMITS,
  FORMAT_TEXT,
  PresentationDraft,
  STATUS_TEXT,
  aiError,
  createBody,
  emptyDraft,
  validateDraft,
} from './studio';

/**
 * /studio (ADR 0029): apresentações geradas por IA a partir de uma descrição. A IA escolhe as
 * métricas e escreve a narrativa; os números são calculados pelo Delta. Só a equipe.
 */
@Component({
  selector: 'app-studio-page',
  imports: [FormsModule, RouterLink, DsButton, DsGlassCard, DsIcon, DsSkeleton, DsTextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './studio.css',
  template: `
    <header class="mb-8">
      <h1 class="m-0 text-large-title font-bold tracking-tight">Studio</h1>
      <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
        Descreva a apresentação que você quer e o Studio monta slides ou uma página única com os dados do projeto. A IA escolhe
        as métricas e escreve a narrativa; os números são calculados pelo Delta, como num relatório.
      </p>
    </header>

    @if (!isStaff()) {
      <ds-glass-card padding="lg" role="note">
        <p class="m-0 text-headline">O Studio é da equipe da agência.</p>
      </ds-glass-card>
    } @else {
      <div class="col">
        @if (creating()) {
          <ds-glass-card padding="lg" data-testid="studio-form">
            <h2 class="m-0 text-headline">Nova apresentação</h2>
            <form class="form" (submit)="$event.preventDefault(); create()" novalidate aria-label="Nova apresentação">
              <div class="grid-2">
                <label class="field">
                  <span class="label">Projeto</span>
                  <select name="project_id" [value]="draft().project_id" (change)="patch({ project_id: $any($event.target).value })">
                    <option value="">Escolha…</option>
                    @for (p of projects(); track p.id) {
                      <option [value]="p.id" [selected]="p.id === draft().project_id">{{ p.name }}</option>
                    }
                  </select>
                  @if (errors()['project_id']) {
                    <small class="error" role="alert">{{ errors()['project_id'] }}</small>
                  }
                </label>
                <ds-text-field label="Título (opcional)" name="title" placeholder="Ex.: Resultados de outubro" [maxlength]="160" [ngModel]="draft().title" (ngModelChange)="patch({ title: $event })" [error]="errors()['title'] ?? null" />
              </div>

              <label class="field">
                <span class="label">O que você quer apresentar?</span>
                <textarea
                  name="brief"
                  rows="5"
                  [maxlength]="limits.max"
                  placeholder="Ex.: Apresentação mensal para o dono da padaria, com foco em vendas pelo Instagram e no custo por pedido."
                  [ngModel]="draft().brief"
                  (ngModelChange)="patch({ brief: $event })"
                  [attr.aria-invalid]="!!errors()['brief']"
                  aria-describedby="brief-hint"
                ></textarea>
                <small id="brief-hint" class="hint">{{ draft().brief.trim().length }}/{{ limits.max }} · quanto mais contexto (público, objetivo, tom), melhor.</small>
                @if (errors()['brief']) {
                  <small class="error" role="alert">{{ errors()['brief'] }}</small>
                }
              </label>

              <fieldset class="field">
                <legend class="label">Formato</legend>
                <div class="chips">
                  @for (f of formats; track f.key) {
                    <label class="radio">
                      <input type="radio" name="format" [value]="f.key" [checked]="draft().format === f.key" (change)="patch({ format: f.key })" />
                      <span>{{ f.text }}</span>
                    </label>
                  }
                </div>
              </fieldset>

              <div class="grid-2">
                <label class="field">
                  <span class="label">Período</span>
                  <select name="period_preset" [value]="draft().period_preset" (change)="patch({ period_preset: $any($event.target).value })">
                    @for (p of periods; track p.value) {
                      <option [value]="p.value" [selected]="p.value === draft().period_preset">{{ p.label }}</option>
                    }
                  </select>
                </label>
                <label class="field">
                  <span class="label">Comparar com</span>
                  <select name="compare" [value]="draft().compare" (change)="patch({ compare: $any($event.target).value })">
                    @for (c of compares; track c.value) {
                      <option [value]="c.value" [selected]="c.value === draft().compare">{{ c.label }}</option>
                    }
                  </select>
                </label>
              </div>
              @if (draft().period_preset === 'custom') {
                <div class="grid-2">
                  <label class="field">
                    <span class="label">Início</span>
                    <input type="date" name="period_start" [value]="draft().period_start" (change)="patch({ period_start: $any($event.target).value })" />
                    @if (errors()['period_start']) {
                      <small class="error" role="alert">{{ errors()['period_start'] }}</small>
                    }
                  </label>
                  <label class="field">
                    <span class="label">Fim</span>
                    <input type="date" name="period_end" [value]="draft().period_end" (change)="patch({ period_end: $any($event.target).value })" />
                    @if (errors()['period_end']) {
                      <small class="error" role="alert">{{ errors()['period_end'] }}</small>
                    }
                  </label>
                </div>
              }

              @if (formError(); as e) {
                <p class="m-0 error-box" role="alert" data-testid="studio-ai-error">
                  {{ e }}
                  @if (tenant.isAdmin()) {
                    <a routerLink="/configuracoes/ia">Configurar a IA</a>
                  }
                </p>
              }

              <div class="actions">
                <button ds-button type="button" variant="ghost" (click)="creating.set(false)">Cancelar</button>
                <button ds-button type="submit" [loading]="saving()" [disabled]="saving()">
                  <svg dsIcon="sparkles" [size]="14"></svg> Gerar apresentação
                </button>
              </div>
            </form>
          </ds-glass-card>
        } @else {
          <div class="actions" style="justify-content: flex-start">
            <button ds-button (click)="startCreate()"><svg dsIcon="plus" [size]="14"></svg> Nova apresentação</button>
          </div>
        }

        <section aria-labelledby="studio-list-title">
          <h2 id="studio-list-title" class="m-0 text-title-3 font-semibold">Apresentações</h2>
          @if (list.isLoading() && !list.hasValue()) {
            <ds-glass-card padding="lg" class="mt-4"><ds-skeleton width="60%" /></ds-glass-card>
          } @else if (list.error()) {
            <ds-glass-card padding="lg" class="mt-4" role="alert">
              <p class="m-0">Não foi possível carregar as apresentações.</p>
              <button ds-button variant="secondary" size="sm" class="mt-3" (click)="list.reload()">Tentar de novo</button>
            </ds-glass-card>
          } @else if (items().length === 0) {
            <ds-glass-card padding="lg" class="mt-4" data-testid="studio-empty">
              <p class="m-0 text-headline">Nenhuma apresentação ainda.</p>
              <p class="m-0 mt-2 text-footnote text-fg-muted">
                Peça, por exemplo, “resultados do mês para a reunião com o cliente” ou “diagnóstico da mídia paga com próximos
                passos”. Depois, ajuste conversando: cada ajuste vira uma versão nova, e dá para voltar a qualquer uma.
              </p>
            </ds-glass-card>
          } @else {
            <ul class="items" aria-label="Apresentações">
              @for (p of items(); track p.id) {
                <li>
                  <a class="item ds-glass" [routerLink]="['/studio', p.id]" [attr.data-id]="p.id">
                    <span class="icon" aria-hidden="true"><svg dsIcon="presentation" [size]="20"></svg></span>
                    <span class="min-w-0 flex-1">
                      <strong class="text-subhead title">{{ p.title }}</strong>
                      <span class="block text-caption text-fg-muted">
                        {{ p.project.name ?? 'Projeto' }} · {{ formatText(p.format) }} · {{ ago(p.updated_at) }}
                      </span>
                    </span>
                    <span class="badge" [class]="'badge is-' + p.status">{{ statusText(p.status) }}</span>
                  </a>
                </li>
              }
            </ul>
          }
        </section>
      </div>
    }
  `,
  styles: `
    .items { list-style: none; margin: var(--ds-space-4) 0 0; padding: 0; display: grid; gap: var(--ds-space-3); }
    .item {
      display: flex; align-items: center; gap: var(--ds-space-3); padding: var(--ds-space-4);
      border-radius: var(--ds-radius-lg); color: var(--ds-text); text-decoration: none;
    }
    .item:focus-visible { outline: 2px solid var(--ds-accent); outline-offset: 2px; }
    .title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .block { display: block; }
  `,
})
export class StudioPage {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  protected readonly tenant = inject(TenantService);

  protected readonly isStaff = computed(() => !!this.tenant.current() && this.tenant.current()?.role !== 'client');

  protected readonly list = httpResource<ApiEnvelope<PresentationSummary[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId && this.isStaff() ? { url: API.presentations, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });
  protected readonly items = computed(() => (this.list.hasValue() ? this.list.value().data : []));

  private readonly projectsRes = httpResource<ApiEnvelope<Project[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId && this.isStaff() && this.creating() ? { url: API.projects, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });
  protected readonly projects = computed(() => (this.projectsRes.hasValue() ? this.projectsRes.value().data : []));

  protected readonly creating = signal(false);
  protected readonly draft = signal<PresentationDraft>(emptyDraft());
  protected readonly errors = signal<FieldErrors>({});
  protected readonly formError = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly limits = BRIEF_LIMITS;
  protected readonly periods = PERIOD_PRESETS;
  protected readonly compares = COMPARE_OPTIONS;
  protected readonly formats: readonly { key: PresentationFormat; text: string }[] = [
    { key: 'slides', text: 'Slides (para apresentar)' },
    { key: 'page', text: 'Página única (para ler)' },
  ];

  protected startCreate(): void {
    this.draft.set(emptyDraft());
    this.errors.set({});
    this.formError.set(null);
    this.creating.set(true);
  }

  protected patch(change: Partial<PresentationDraft>): void {
    this.draft.update((d) => ({ ...d, ...change }));
  }

  protected async create(): Promise<void> {
    const errors = validateDraft(this.draft());
    this.errors.set(errors);
    this.formError.set(null);
    if (Object.keys(errors).length > 0) return;

    this.saving.set(true);
    try {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<Presentation>>(API.presentations, createBody(this.draft())));
      this.creating.set(false);
      await this.router.navigate(['/studio', res.data.id]);
    } catch (error) {
      if (isPlanLimitError(error)) return; // o diálogo do plano explica
      const ai = aiError(error);
      if (ai) {
        this.formError.set(ai);
        return;
      }
      const fields = extractFieldErrors(error);
      if (fields) this.errors.set(fields);
      else this.formError.set('Não foi possível pedir a apresentação agora.');
    } finally {
      this.saving.set(false);
    }
  }

  protected formatText(format: PresentationFormat): string {
    return FORMAT_TEXT[format];
  }

  protected statusText(status: PresentationSummary['status']): string {
    return STATUS_TEXT[status];
  }

  protected ago(iso: string): string {
    return relativeTime(iso);
  }
}
