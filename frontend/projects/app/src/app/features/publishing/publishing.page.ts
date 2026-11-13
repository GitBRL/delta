import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideChevronLeft, LucideChevronRight } from '@lucide/angular';
import { DsButton, DsGlassCard, DsIcon, DsSkeleton } from 'design-system';
import { API, ApiEnvelope, Post, PostStatus, Project, PublishNetwork, TENANT_HEADER } from '../../core/api/api.types';
import { TenantService } from '../../core/tenant/tenant.service';
import { ProviderIcon } from '../integrations/provider-icon';
import { MediaLibrary } from './media-library';
import {
  CalendarView,
  NETWORK_TEXT,
  STATUS_FILTERS,
  STATUS_TEXT,
  WEEKDAYS,
  calendarRange,
  calendarTitle,
  dayKey,
  formatDayTitle,
  formatText,
  formatTime,
  groupByDay,
  monthGrid,
  postCounters,
  postDate,
  shiftAnchor,
  statusTone,
  weekDays,
} from './publishing';

export type PublishingTab = 'calendar' | 'list' | 'media';

/** Até quantos posts cada dia do mês mostra antes do "+N". */
export const DAY_CHIPS = 3;

/**
 * Publicações (ADR 0028): calendário editorial (mês e semana), lista (melhor no celular) e
 * biblioteca de mídia. Todos leem (o cliente só os projetos dele); a equipe cria e edita.
 */
@Component({
  selector: 'app-publishing-page',
  imports: [RouterLink, DsButton, DsGlassCard, DsIcon, DsSkeleton, ProviderIcon, MediaLibrary, LucideChevronLeft, LucideChevronRight],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <div class="min-w-0 flex-1">
        <h1 class="m-0 text-large-title font-bold tracking-tight">Publicações</h1>
        <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
          {{ isStaff() ? 'Calendário editorial dos clientes: crie posts, peça a aprovação e agende para o Instagram, o Facebook e o YouTube.' : 'Os posts preparados pela agência para os seus projetos.' }}
        </p>
      </div>
      @if (isStaff()) {
        <a ds-button routerLink="/publicacoes/novo" [queryParams]="projectFilter() ? { projeto: projectFilter() } : {}">
          <svg dsIcon="plus" [size]="14"></svg> Novo post
        </a>
      }
    </header>

    <!-- Contadores -->
    <div class="counters" data-testid="counters">
      <button type="button" class="counter" (click)="showStatus('in_review')" [class.on]="statusFilter() === 'in_review'">
        <strong>{{ counters().review }}</strong>
        <span>aguardando aprovação</span>
      </button>
      <button type="button" class="counter" (click)="showStatus('scheduled')" [class.on]="statusFilter() === 'scheduled'">
        <strong>{{ counters().upcoming }}</strong>
        <span>agendados nos próximos 7 dias</span>
      </button>
      <button type="button" class="counter" data-tone="critical" (click)="showStatus('failed')" [class.on]="statusFilter() === 'failed'">
        <strong>{{ counters().failed }}</strong>
        <span>com falha</span>
      </button>
    </div>

    <!-- Abas e filtros -->
    <div class="bar">
      <div class="tabs" role="tablist" aria-label="Visualização">
        <button type="button" role="tab" class="tab" [class.on]="tab() === 'calendar'" [attr.aria-selected]="tab() === 'calendar'" (click)="tab.set('calendar')">Calendário</button>
        <button type="button" role="tab" class="tab" [class.on]="tab() === 'list'" [attr.aria-selected]="tab() === 'list'" (click)="tab.set('list')">Lista</button>
        @if (isStaff()) {
          <button type="button" role="tab" class="tab" [class.on]="tab() === 'media'" [attr.aria-selected]="tab() === 'media'" (click)="tab.set('media')">Mídia</button>
        }
      </div>
      <div class="filters">
        <label class="ds-visually-hidden" for="pub-project">Projeto</label>
        <select id="pub-project" [value]="projectFilter()" (change)="projectFilter.set($any($event.target).value)" data-testid="project-filter">
          <option value="">Todos os projetos</option>
          @for (p of projectList(); track p.id) {
            <option [value]="p.id" [selected]="p.id === projectFilter()">{{ p.name }}</option>
          }
        </select>
        @if (tab() !== 'media') {
          <label class="ds-visually-hidden" for="pub-status">Status</label>
          <select id="pub-status" [value]="statusFilter()" (change)="statusFilter.set($any($event.target).value)" data-testid="status-filter">
            <option value="">Todos os status</option>
            @for (s of statusFilters; track s) {
              <option [value]="s" [selected]="s === statusFilter()">{{ statusText[s] }}</option>
            }
          </select>
        }
      </div>
    </div>

    @if (tab() === 'media') {
      <ds-glass-card padding="lg">
        <app-media-library [projectId]="projectFilter() || null" [canManage]="isStaff()" />
      </ds-glass-card>
    } @else {
      <!-- Navegação do período -->
      <div class="nav">
        <button class="icon-btn" type="button" (click)="move(-1)" [attr.aria-label]="view() === 'month' ? 'Mês anterior' : 'Semana anterior'">
          <svg lucideChevronLeft [size]="16"></svg>
        </button>
        <h2 class="m-0 text-title-3 font-semibold" aria-live="polite" data-testid="period-title">{{ title() }}</h2>
        <button class="icon-btn" type="button" (click)="move(1)" [attr.aria-label]="view() === 'month' ? 'Próximo mês' : 'Próxima semana'">
          <svg lucideChevronRight [size]="16"></svg>
        </button>
        <button ds-button variant="ghost" size="sm" (click)="today()">Hoje</button>
        @if (tab() === 'calendar') {
          <span class="spacer"></span>
          <div class="seg" role="group" aria-label="Período do calendário">
            <button type="button" [class.on]="view() === 'month'" [attr.aria-pressed]="view() === 'month'" (click)="setView('month')">Mês</button>
            <button type="button" [class.on]="view() === 'week'" [attr.aria-pressed]="view() === 'week'" (click)="setView('week')">Semana</button>
          </div>
        }
      </div>

      @if (posts.isLoading() && !posts.hasValue()) {
        <ds-glass-card padding="lg" aria-busy="true"><ds-skeleton height="240px" /></ds-glass-card>
      } @else if (posts.error()) {
        <ds-glass-card padding="lg" role="alert">
          <p class="m-0">Não foi possível carregar as publicações.</p>
          <button ds-button variant="secondary" size="sm" class="mt-3" (click)="posts.reload()">Tentar de novo</button>
        </ds-glass-card>
      } @else if (tab() === 'calendar') {
        <div class="calendar" [attr.data-view]="view()" role="grid" [attr.aria-label]="'Calendário: ' + title()" data-testid="calendar">
          <div class="row head" role="row">
            @for (w of weekdays; track w) {
              <span class="weekday" role="columnheader">{{ w }}</span>
            }
          </div>
          @for (week of weeks(); track $index) {
            <div class="row" role="row">
              @for (day of week; track day.getTime()) {
                @let key = keyOf(day);
                @let items = byDay().get(key) ?? [];
                <div class="day" role="gridcell" [class.out]="isOutside(day)" [class.today]="key === todayKey()" [attr.data-day]="key">
                  <span class="num" [attr.aria-label]="dayTitle(day)">{{ day.getDate() }}</span>
                  @for (p of view() === 'month' ? items.slice(0, chipLimit) : items; track p.id) {
                    <a class="chip" [routerLink]="['/publicacoes', p.id]" [attr.data-tone]="tone(p.status)" [attr.data-post]="p.id" [title]="statusText[p.status]">
                      <span class="nets" aria-hidden="true">
                        @for (t of p.targets; track t.id) {
                          <app-provider-icon [provider]="t.network" [size]="11" />
                        }
                      </span>
                      <span class="time">{{ time(date(p)) }}</span>
                      <span class="label">{{ p.title || p.project.name || 'Post' }}</span>
                      <span class="ds-visually-hidden">· {{ statusText[p.status] }}</span>
                    </a>
                  }
                  @if (view() === 'month' && items.length > chipLimit) {
                    <button type="button" class="more" (click)="openDay(day)">+{{ items.length - chipLimit }}</button>
                  }
                </div>
              }
            </div>
          }
        </div>
        @if (filtered().length === 0) {
          <p class="m-0 text-footnote text-fg-muted" data-testid="calendar-empty">Nenhuma publicação neste período{{ statusFilter() ? ' com este status' : '' }}.</p>
        }
      } @else {
        <!-- Lista -->
        @if (days().length === 0) {
          <ds-glass-card padding="lg" data-testid="list-empty">
            <p class="m-0 text-headline">Nenhuma publicação neste período.</p>
            @if (isStaff()) {
              <p class="m-0 mt-2 text-footnote text-fg-muted">Crie um post, peça a aprovação do cliente por link e agende: o Delta publica na hora marcada.</p>
            }
          </ds-glass-card>
        } @else {
          <div class="list" data-testid="list">
            @for (group of days(); track group.key) {
              <section [attr.aria-label]="group.title">
                <h3 class="m-0 text-subhead font-semibold day-title">{{ group.title }}</h3>
                <ul class="items">
                  @for (p of group.posts; track p.id) {
                    <li>
                      <a class="item" [routerLink]="['/publicacoes', p.id]" [attr.data-post]="p.id">
                        <span class="time text-footnote">{{ time(date(p)) }}</span>
                        <span class="min-w-0 flex-1">
                          <strong class="block truncate text-subhead">{{ p.title || 'Post sem título' }}</strong>
                          <small class="block truncate text-caption text-fg-muted">
                            {{ p.project.name }}
                            @for (t of p.targets; track t.id) {
                              · {{ networkName(t.network) }} {{ formatLabel(t.format) }}
                            }
                          </small>
                        </span>
                        <span class="status" [attr.data-tone]="tone(p.status)">{{ statusText[p.status] }}</span>
                      </a>
                    </li>
                  }
                </ul>
              </section>
            }
          </div>
        }
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-5);
    }
    .top {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--ds-space-3);
    }
    .counters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: var(--ds-space-3);
    }
    .counter {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      padding: var(--ds-space-3) var(--ds-space-4);
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-lg);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      text-align: left;
      cursor: pointer;
    }
    .counter strong {
      font: var(--ds-text-title-2);
      font-weight: 700;
    }
    .counter span {
      font: var(--ds-text-footnote);
      color: var(--ds-text-secondary);
    }
    .counter.on {
      border-color: var(--ds-accent);
    }
    .counter[data-tone='critical'] strong {
      color: var(--ds-status-critical);
    }
    .bar,
    .nav {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .bar {
      justify-content: space-between;
    }
    .tabs,
    .filters,
    .seg {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .tab,
    .seg button {
      padding: 6px 14px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-full);
      background: transparent;
      color: var(--ds-text);
      font: var(--ds-text-footnote);
      cursor: pointer;
    }
    .tab.on,
    .seg button.on {
      border-color: var(--ds-accent);
      background: color-mix(in oklch, var(--ds-accent) 14%, transparent);
      color: var(--ds-accent);
      font-weight: 600;
    }
    select {
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
    }
    .spacer {
      flex: 1;
    }
    .icon-btn {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      background: transparent;
      color: var(--ds-text);
      cursor: pointer;
    }
    .calendar {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-lg);
      background: var(--ds-bg-elevated);
    }
    .row {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
    }
    .weekday {
      padding: 6px;
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
      text-align: center;
      text-transform: uppercase;
      border-bottom: 1px solid var(--ds-separator);
    }
    .day {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
      min-height: 96px;
      padding: 4px;
      border-right: 1px solid var(--ds-separator);
      border-bottom: 1px solid var(--ds-separator);
    }
    .calendar[data-view='week'] .day {
      min-height: 260px;
    }
    .day.out {
      background: var(--ds-fill);
      opacity: 0.7;
    }
    .num {
      align-self: flex-end;
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
    }
    .day.today .num {
      display: inline-grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--ds-accent);
      color: white;
      font-weight: 700;
    }
    .chip {
      display: flex;
      align-items: center;
      gap: 3px;
      min-width: 0;
      padding: 2px 5px;
      border-left: 3px solid var(--ds-separator);
      border-radius: 4px;
      background: var(--ds-fill);
      color: var(--ds-text);
      font: var(--ds-text-caption);
      text-decoration: none;
    }
    .chip[data-tone='accent'] {
      border-left-color: var(--ds-accent);
    }
    .chip[data-tone='attention'] {
      border-left-color: var(--ds-status-attention);
    }
    .chip[data-tone='healthy'] {
      border-left-color: var(--ds-status-healthy);
    }
    .chip[data-tone='critical'] {
      border-left-color: var(--ds-status-critical);
    }
    .chip[data-tone='muted'] {
      opacity: 0.6;
      text-decoration: line-through;
    }
    .nets {
      display: inline-flex;
      flex: none;
      gap: 1px;
      color: var(--ds-text-secondary);
    }
    .time {
      flex: none;
      color: var(--ds-text-tertiary);
    }
    .label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .more {
      align-self: flex-start;
      padding: 0 4px;
      border: 0;
      background: transparent;
      color: var(--ds-accent);
      font: var(--ds-text-caption);
      font-weight: 600;
      cursor: pointer;
    }
    @media (max-width: 640px) {
      .day {
        min-height: 64px;
      }
      .chip .label,
      .chip .time {
        display: none;
      }
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    .day-title {
      margin-bottom: var(--ds-space-2);
      color: var(--ds-text-secondary);
      text-transform: capitalize;
    }
    .items {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      align-items: center;
      gap: var(--ds-space-3);
      padding: var(--ds-space-3);
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      background: var(--ds-bg-elevated);
      color: inherit;
      text-decoration: none;
    }
    .item .time {
      width: 44px;
      flex: none;
    }
    .status {
      flex: none;
      padding: 2px 10px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-fill);
      color: var(--ds-text-secondary);
      font: var(--ds-text-caption);
      font-weight: 600;
    }
    .status[data-tone='accent'] {
      background: color-mix(in oklch, var(--ds-accent) 14%, transparent);
      color: var(--ds-accent);
    }
    .status[data-tone='attention'] {
      background: color-mix(in oklch, var(--ds-status-attention) 18%, transparent);
      color: var(--ds-status-attention);
    }
    .status[data-tone='healthy'] {
      background: color-mix(in oklch, var(--ds-status-healthy) 16%, transparent);
      color: var(--ds-status-healthy);
    }
    .status[data-tone='critical'] {
      background: color-mix(in oklch, var(--ds-status-critical) 14%, transparent);
      color: var(--ds-status-critical);
    }
  `,
})
export class PublishingPage implements OnInit {
  /** ?projeto= (link do projeto). */
  readonly projeto = input<string | undefined>(undefined);

  protected readonly tenant = inject(TenantService);

  protected readonly statusText = STATUS_TEXT;
  protected readonly statusFilters = STATUS_FILTERS;
  protected readonly weekdays = WEEKDAYS;
  protected readonly chipLimit = DAY_CHIPS;
  protected readonly tone = statusTone;
  protected readonly time = formatTime;
  protected readonly date = postDate;
  protected readonly keyOf = dayKey;
  protected readonly dayTitle = formatDayTitle;
  protected readonly formatLabel = formatText;

  readonly tab = signal<PublishingTab>('calendar');
  readonly view = signal<CalendarView>('month');
  readonly anchor = signal(new Date());
  readonly projectFilter = signal('');
  readonly statusFilter = signal<PostStatus | ''>('');
  protected readonly todayKey = signal(dayKey(new Date()));

  protected readonly isStaff = computed(() => !!this.tenant.current() && this.tenant.current()?.role !== 'client');

  private readonly request = (url: string, params: Record<string, string>) => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url, params, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  };
  private readonly range = computed(() => calendarRange(this.tab() === 'calendar' ? this.view() : 'month', this.anchor()));

  readonly posts = httpResource<ApiEnvelope<Post[]>>(() => {
    if (this.tab() === 'media') return undefined;
    const { from, to } = this.range();
    return this.request(API.posts, { from, to, ...(this.projectFilter() ? { project_id: this.projectFilter() } : {}) });
  });
  /** Contadores independem do período: tudo que está em revisão, agendado ou com falha. */
  readonly pending = httpResource<ApiEnvelope<Post[]>>(() =>
    this.request(API.posts, { status: 'in_review,scheduled,failed', ...(this.projectFilter() ? { project_id: this.projectFilter() } : {}) }),
  );
  readonly projects = httpResource<ApiEnvelope<Project[]>>(() => this.request(API.projects, {}));
  protected readonly projectList = computed(() => (this.projects.hasValue() ? this.projects.value().data : []));

  protected readonly filtered = computed(() => {
    const posts = this.posts.hasValue() ? this.posts.value().data : [];
    const status = this.statusFilter();
    return status ? posts.filter((p) => p.status === status) : posts;
  });
  protected readonly byDay = computed(() => groupByDay(this.filtered()));
  protected readonly counters = computed(() => postCounters(this.pending.hasValue() ? this.pending.value().data : []));
  protected readonly weeks = computed(() => (this.view() === 'month' ? monthGrid(this.anchor()) : [weekDays(this.anchor())]));
  protected readonly title = computed(() => calendarTitle(this.tab() === 'calendar' ? this.view() : 'month', this.anchor()));
  /** Lista: dias com posts, em ordem. */
  protected readonly days = computed(() =>
    [...this.byDay().entries()].map(([key, posts]) => {
      const [y, m, d] = key.split('-').map(Number);
      return { key, posts, title: formatDayTitle(new Date(y, m - 1, d)) };
    }),
  );

  ngOnInit(): void {
    if (this.projeto()) this.projectFilter.set(this.projeto() ?? '');
    // No celular, a lista lê melhor que a grade do mês.
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches) {
      this.tab.set('list');
    }
  }

  move(delta: number): void {
    this.anchor.set(shiftAnchor(this.tab() === 'calendar' ? this.view() : 'month', this.anchor(), delta));
  }

  today(): void {
    this.anchor.set(new Date());
  }

  setView(view: CalendarView): void {
    this.view.set(view);
  }

  /** "+N" no mês: abre a semana daquele dia. */
  openDay(day: Date): void {
    this.anchor.set(day);
    this.view.set('week');
  }

  /** Contador clicado: filtra por aquele status (de novo: tira o filtro). */
  showStatus(status: PostStatus): void {
    this.statusFilter.set(this.statusFilter() === status ? '' : status);
    if (this.tab() === 'media') this.tab.set('list');
  }

  protected isOutside(day: Date): boolean {
    return this.view() === 'month' && day.getMonth() !== this.anchor().getMonth();
  }

  protected networkName(network: PublishNetwork): string {
    return NETWORK_TEXT[network] ?? network;
  }
}
