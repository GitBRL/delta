import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DsButton,
  DsGlassCard,
  DsHealthRings,
  DsIcon,
  DsKpiTile,
  DsSkeleton,
  DsStatusBadge,
  formatMetric,
} from 'design-system';
import { API, ApiEnvelope, CompareMode, Overview, RelativePeriodPreset } from '../../core/api/api.types';
import { relativeTime } from '../../core/format/relative-time';
import { COMPARE_OPTIONS, compareCaption } from '../../core/metrics/period';
import { formatterFor, kpiDirection } from '../../core/metrics/metrics-query.service';
import { TenantService } from '../../core/tenant/tenant.service';
import { ProviderIcon } from '../integrations/provider-icon';
import { OVERVIEW_PRESETS, PROJECT_STATUS_LABEL, hasAnyHealth, healthLegend, kpiTrend } from './overview';

/**
 * Visão geral da agência (GET /api/overview): mídia combinada, saúde da carteira por etapa do
 * funil, Radar com o que pede ação e o estado de cada projeto. O cliente vê só os projetos dele.
 */
@Component({
  selector: 'app-overview-page',
  imports: [RouterLink, DsButton, DsKpiTile, DsHealthRings, DsGlassCard, DsStatusBadge, DsSkeleton, DsIcon, ProviderIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="m-0 text-footnote font-semibold uppercase tracking-wider text-fg-subtle">
          {{ tenant.current()?.name }}
        </p>
        <h1 class="m-0 mt-1 text-large-title font-bold tracking-tight">Visão geral</h1>
        @if (data(); as d) {
          <p class="m-0 mt-1 text-footnote text-fg-muted">
            {{ d.period.label }}{{ caption() ? ' · ' + caption() : '' }} · atualizado {{ relativeTime(d.generated_at) }}
          </p>
        }
      </div>
      <div class="controls">
        <label class="ctl">
          <span>Período</span>
          <select [value]="preset()" (change)="setPreset($event)" aria-label="Período">
            @for (p of presets; track p.value) {
              <option [value]="p.value" [selected]="p.value === preset()">{{ p.label }}</option>
            }
          </select>
        </label>
        <label class="ctl">
          <span>Comparar com</span>
          <select [value]="compare()" (change)="setCompare($event)" aria-label="Comparação">
            @for (c of compareOptions; track c.value) {
              <option [value]="c.value" [selected]="c.value === compare()">{{ c.label }}</option>
            }
          </select>
        </label>
        <button ds-button variant="secondary" size="sm" [loading]="overview.isLoading() && refreshKey() > 0" (click)="refresh()">
          Atualizar
        </button>
      </div>
    </header>

    @if (overview.isLoading() && !overview.hasValue()) {
      <section class="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
        @for (i of [1, 2, 3, 4]; track i) {
          <div class="skeleton-tile ds-glass"><ds-skeleton width="50%" /><ds-skeleton width="70%" height="28px" /></div>
        }
      </section>
    } @else if (overview.error() && !overview.hasValue()) {
      <ds-glass-card padding="lg" class="block" role="alert">
        <p class="m-0 text-headline">Não foi possível carregar a visão geral.</p>
        <button ds-button variant="secondary" size="sm" class="mt-3" (click)="overview.reload()">Tentar de novo</button>
      </ds-glass-card>
    } @else if (data(); as d) {
      @if (d.counts.projects === 0) {
        <ds-glass-card padding="lg" class="mb-8 block empty" animate.enter="ds-enter-fade-up">
          <span class="cta-icon" aria-hidden="true"><svg dsIcon="folder-kanban" [size]="24"></svg></span>
          <div class="min-w-0 flex-1">
            <h2 class="m-0 text-title-3 font-semibold">Comece pelo primeiro projeto</h2>
            <p class="m-0 mt-1 text-subhead text-fg-muted">
              Cada projeto é um cliente da agência. Crie um, conecte as contas dele em Integrações e a visão
              geral passa a mostrar a carteira inteira.
            </p>
          </div>
          <a ds-button routerLink="/projetos">Criar projeto</a>
        </ds-glass-card>
      } @else {
        @if (noDataCount() > 0) {
          <ds-glass-card padding="md" class="mb-6 block" animate.enter="ds-enter-fade-up">
            <div class="empty">
              <span class="cta-icon small" aria-hidden="true"><svg dsIcon="plug" [size]="20"></svg></span>
              <p class="m-0 min-w-0 flex-1 text-subhead">
                <strong>{{ noDataCount() === 1 ? '1 projeto está' : noDataCount() + ' projetos estão' }} sem contas conectadas.</strong>
                <span class="text-fg-muted"> Conecte e vincule as contas para os números entrarem aqui.</span>
              </p>
              <a ds-button variant="secondary" size="sm" routerLink="/integracoes">Conectar contas</a>
            </div>
          </ds-glass-card>
        }

        <section class="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Mídia combinada">
          @for (kpi of d.kpis; track kpi.key) {
            <ds-kpi-tile
              [label]="kpi.label"
              [value]="kpi.value"
              [formatter]="formatterFor(kpi.unit, kpi.decimals)"
              [trend]="kpiTrend(kpi, d.compare)"
              [direction]="kpiDirection(kpi.direction)"
              [sentiment]="kpi.sentiment"
              [comparisonLabel]="caption()"
              [style.animation-delay.ms]="$index * 60"
            />
          }
        </section>
        <p class="note">Investimento, conversões, CPA e ROAS somam Meta Ads e Google Ads de todos os projetos.</p>

        <section class="mb-8 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <ds-glass-card [interactive]="true" padding="lg">
            <h2 class="m-0 text-title-3 font-semibold">Saúde da carteira</h2>
            <p class="mb-6 mt-1 text-footnote text-fg-muted">Indicadores dentro das boas práticas, por etapa do funil (0 a 100).</p>
            @if (hasHealth()) {
              <div class="rings">
                <ds-health-rings
                  [acquisition]="d.health.acquisition ?? 0"
                  [engagement]="d.health.engagement ?? 0"
                  [conversion]="d.health.conversion ?? 0"
                  [showLegend]="false"
                />
                <ul class="legend">
                  @for (item of legend(); track item.key) {
                    <li [attr.data-ring]="item.key">
                      <span class="swatch" [style.background]="'var(--ds-ring-' + item.key + ')'" aria-hidden="true"></span>
                      <span class="name">{{ item.label }}</span>
                      <span class="pct ds-tabular">{{ item.value === null ? 'sem dados' : item.value }}</span>
                    </li>
                  }
                </ul>
              </div>
            } @else {
              <p class="m-0 text-subhead text-fg-muted">Sem indicadores avaliados ainda: conecte contas aos projetos.</p>
            }
          </ds-glass-card>

          <ds-glass-card padding="lg">
            <h2 class="m-0 text-title-3 font-semibold">Radar</h2>
            <p class="mb-4 mt-1 text-footnote text-fg-muted">O que pede ação agora, do mais urgente para o menos.</p>
            @if (d.radar.length === 0) {
              <p class="all-good">Nenhum ponto de atenção agora: os indicadores avaliados estão dentro das boas práticas.</p>
            } @else {
              <ul class="m-0 flex list-none flex-col gap-1 p-0">
                @for (signal of d.radar; track signal.project_id + signal.rule) {
                  <li>
                    <a class="radar-item" [routerLink]="['/projetos', signal.project_id]">
                      <div class="min-w-0">
                        <p class="m-0 text-footnote font-semibold text-fg-muted">{{ signal.project }}</p>
                        <p class="m-0 text-subhead font-semibold">{{ signal.title }}</p>
                        <p class="m-0 text-footnote text-fg-muted">{{ signal.suggestion }}</p>
                      </div>
                      <ds-status-badge [status]="signal.status" />
                    </a>
                  </li>
                }
              </ul>
            }
          </ds-glass-card>
        </section>

        <section aria-labelledby="projects-title">
          <h2 id="projects-title" class="m-0 mb-4 text-title-3 font-semibold">Projetos</h2>
          <div class="projects">
            @for (p of d.projects; track p.id) {
              <a class="project ds-glass" [routerLink]="['/projetos', p.id]" [attr.data-status]="p.status" animate.enter="ds-enter-fade-up">
                <div class="project-head">
                  <strong class="truncate">{{ p.name }}</strong>
                  @if (p.status === 'no_data') {
                    <span class="chip">{{ statusLabel.no_data }}</span>
                  } @else {
                    <ds-status-badge [status]="p.status" [compact]="true" />
                  }
                </div>
                <p class="m-0 text-subhead">{{ p.headline }}</p>
                <p class="m-0 text-footnote text-fg-muted">{{ p.detail }}</p>
                <div class="project-foot">
                  <span class="providers">
                    @for (provider of p.providers; track provider) {
                      <app-provider-icon [provider]="provider" [size]="14" />
                    }
                  </span>
                  @if (p.health !== null && p.health !== undefined) {
                    <span class="health ds-tabular" [attr.data-level]="healthLevel(p.health)" [attr.aria-label]="'Saúde da conta ' + p.health + ' de 100'">♥ {{ p.health }}</span>
                  }
                  @if (p.spend !== null) {
                    <span class="text-footnote text-fg-muted ds-tabular">{{ money(p.spend) }} em mídia</span>
                  }
                </div>
              </a>
            }
          </div>
        </section>
      }
    }
  `,
  styles: `
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--ds-space-3);
    }
    .ctl {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
    }
    .ctl select {
      min-height: 34px;
      padding: 0 var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      border: 1px solid var(--ds-separator);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-subhead);
    }
    .skeleton-tile {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      padding: var(--ds-space-5);
      border-radius: var(--ds-radius-lg);
    }
    .empty {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-4);
    }
    .cta-icon {
      display: grid;
      place-items: center;
      width: 52px;
      height: 52px;
      border-radius: var(--ds-radius-lg);
      background: var(--ds-accent-soft);
      color: var(--ds-accent);
    }
    .cta-icon.small {
      width: 40px;
      height: 40px;
    }
    .note {
      margin: -16px 0 var(--ds-space-8);
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
    .rings {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-6);
    }
    .legend {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .legend li {
      display: flex;
      align-items: center;
      gap: var(--ds-space-2);
      font: var(--ds-text-subhead);
    }
    .swatch {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .pct {
      margin-left: auto;
      padding-left: var(--ds-space-4);
      font-weight: 600;
    }
    .all-good {
      margin: 0;
      padding: var(--ds-space-3) var(--ds-space-4);
      border-radius: var(--ds-radius-md);
      background: color-mix(in srgb, var(--ds-status-healthy) 14%, transparent);
      font: var(--ds-text-subhead);
    }
    .radar-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-4);
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      color: inherit;
      text-decoration: none;
    }
    .radar-item:hover {
      background: var(--ds-fill);
    }
    .projects {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: var(--ds-space-4);
    }
    .project {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      padding: var(--ds-space-5);
      border-radius: var(--ds-radius-lg);
      color: inherit;
      text-decoration: none;
      transition: transform var(--ds-duration-fast) var(--ds-ease-out);
    }
    .project:hover {
      transform: translateY(-2px);
    }
    .project[data-status='critical'] {
      box-shadow: inset 3px 0 0 var(--ds-status-critical);
    }
    .project[data-status='attention'] {
      box-shadow: inset 3px 0 0 var(--ds-status-attention);
    }
    .health {
      padding: 1px 8px;
      border-radius: var(--ds-radius-full);
      font: var(--ds-text-caption);
      font-weight: 700;
    }
    .health[data-level='good'] {
      background: color-mix(in oklch, var(--ds-status-healthy) 16%, transparent);
      color: var(--ds-status-healthy);
    }
    .health[data-level='fair'] {
      background: color-mix(in oklch, var(--ds-status-attention) 18%, transparent);
      color: var(--ds-status-attention);
    }
    .health[data-level='poor'] {
      background: color-mix(in oklch, var(--ds-status-critical) 14%, transparent);
      color: var(--ds-status-critical);
    }
    .project-head,
    .project-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-3);
    }
    .project-foot {
      margin-top: auto;
      padding-top: var(--ds-space-2);
    }
    .providers {
      display: inline-flex;
      gap: 6px;
    }
    .chip {
      padding: 2px 10px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-fill);
      color: var(--ds-text-secondary);
      font: var(--ds-text-caption);
      font-weight: 600;
    }
  `,
})
export class OverviewPage {
  protected readonly tenant = inject(TenantService);

  protected readonly presets = OVERVIEW_PRESETS;
  protected readonly compareOptions = COMPARE_OPTIONS;
  protected readonly statusLabel = PROJECT_STATUS_LABEL;
  protected readonly relativeTime = relativeTime;
  protected readonly formatterFor = formatterFor;
  protected readonly kpiDirection = kpiDirection;
  protected readonly kpiTrend = kpiTrend;

  readonly preset = signal<RelativePeriodPreset>('last_30');
  readonly compare = signal<CompareMode>('previous_period');
  /** >0 = o usuário pediu "Atualizar": ignora o cache do servidor nesta busca. */
  readonly refreshKey = signal(0);

  protected readonly overview = httpResource<ApiEnvelope<Overview>>(() => {
    if (!this.tenant.currentId()) return undefined;
    const params: Record<string, string> = { period_preset: this.preset(), compare: this.compare() };
    if (this.refreshKey() > 0) {
      params['refresh'] = '1';
      params['_'] = String(this.refreshKey());
    }
    return { url: API.overview, params };
  });

  protected readonly data = computed(() => (this.overview.hasValue() ? this.overview.value().data : null));
  protected readonly caption = computed(() => compareCaption(this.data()?.compare ?? this.compare()));
  protected readonly legend = computed(() => {
    const d = this.data();
    return d ? healthLegend(d.health) : [];
  });
  protected readonly hasHealth = computed(() => {
    const d = this.data();
    return !!d && hasAnyHealth(d.health);
  });
  /** Mesmas faixas do backend: boa (≥ 80), regular (≥ 60), ruim. */
  protected healthLevel(score: number): 'good' | 'fair' | 'poor' {
    return score >= 80 ? 'good' : score >= 60 ? 'fair' : 'poor';
  }

  protected readonly noDataCount = computed(() => this.data()?.projects.filter((p) => p.status === 'no_data').length ?? 0);

  protected setPreset(event: Event): void {
    this.refreshKey.set(0);
    this.preset.set((event.target as HTMLSelectElement).value as RelativePeriodPreset);
  }

  protected setCompare(event: Event): void {
    this.refreshKey.set(0);
    this.compare.set((event.target as HTMLSelectElement).value as CompareMode);
  }

  refresh(): void {
    this.refreshKey.update((n) => n + 1);
  }

  protected money(value: number): string {
    return formatMetric(value, 'currency', 0);
  }
}
