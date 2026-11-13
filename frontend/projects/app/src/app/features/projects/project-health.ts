import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DsAreaChart, DsButton, DsSkeleton } from 'design-system';
import { API, ApiEnvelope, HealthLevel, ProjectHealth } from '../../core/api/api.types';
import { TenantService } from '../../core/tenant/tenant.service';

export const HEALTH_LEVEL: Readonly<Record<HealthLevel, { label: string; color: string }>> = {
  good: { label: 'Boa', color: 'var(--ds-status-healthy)' },
  fair: { label: 'Regular', color: 'var(--ds-status-attention)' },
  poor: { label: 'Precisa de atenção', color: 'var(--ds-status-critical)' },
};

const RADIUS = 44;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Comprimento do traço do anel para a nota (0–100). */
export function ringDash(score: number): string {
  const filled = (Math.max(0, Math.min(100, score)) / 100) * CIRCUMFERENCE;
  return `${filled.toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`;
}

/** Saúde da conta (0–100) do projeto: nota, fatores que explicam e a tendência diária. */
@Component({
  selector: 'app-project-health',
  imports: [DsAreaChart, DsButton, DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="health-title">
      <h2 id="health-title" class="m-0 mb-3 text-headline">Saúde da conta</h2>

      @if (health.isLoading() && !health.hasValue()) {
        <ds-skeleton height="110px" radius="var(--ds-radius-lg)" />
      } @else if (health.error() && !health.hasValue()) {
        <div role="alert" class="flex flex-col items-start gap-2">
          <p class="m-0 text-footnote text-fg-muted">Não foi possível calcular a saúde agora.</p>
          <button ds-button variant="ghost" size="sm" (click)="health.reload()">Tentar de novo</button>
        </div>
      } @else if (data(); as h) {
        <div class="top">
          <svg class="ring" viewBox="0 0 100 100" role="img" [attr.aria-label]="'Nota de saúde ' + h.score + ' de 100: ' + level().label">
            <circle class="track" cx="50" cy="50" [attr.r]="radius" />
            <circle
              class="fill"
              cx="50"
              cy="50"
              [attr.r]="radius"
              [attr.stroke-dasharray]="dash()"
              [style.stroke]="level().color"
              transform="rotate(-90 50 50)"
            />
            <text x="50" y="50" text-anchor="middle" dominant-baseline="central" class="score">{{ h.score }}</text>
          </svg>
          <div class="info">
            <span class="level" [style.color]="level().color" data-testid="health-level">{{ level().label }}</span>
            @if (h.factors.length) {
              <ul class="factors" aria-label="O que pesa na nota">
                @for (f of h.factors; track f.label) {
                  <li><span>{{ f.label }}</span><span class="impact ds-tabular">{{ impactText(f.impact) }}</span></li>
                }
              </ul>
            } @else {
              <p class="m-0 text-footnote text-fg-muted">Nenhum alerta aberto nem meta fora do ritmo.</p>
            }
          </div>
        </div>

        @if (h.history.length >= 2) {
          <ds-area-chart
            label="Saúde da conta"
            seriesLabel="Nota diária"
            [series]="trend()"
            [height]="90"
            [valueFormatter]="scoreFormat"
          />
        } @else {
          <p class="m-0 mt-2 text-caption text-fg-subtle">A tendência aparece depois de alguns dias: a nota é registrada uma vez por dia.</p>
        }
      }
    </section>
  `,
  styles: `
    .top {
      display: flex;
      align-items: center;
      gap: var(--ds-space-4);
      margin-bottom: var(--ds-space-3);
    }
    .ring {
      flex: none;
      width: 104px;
      height: 104px;
    }
    .track,
    .fill {
      fill: none;
      stroke-width: 9;
    }
    .track {
      stroke: var(--ds-fill);
    }
    .fill {
      stroke-linecap: round;
      transition: stroke-dasharray var(--ds-duration-slow) var(--ds-ease-spring-gentle);
    }
    .score {
      fill: var(--ds-text);
      font-size: 26px;
      font-weight: 700;
    }
    .info {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      min-width: 0;
    }
    .level {
      font: var(--ds-text-subhead);
      font-weight: 700;
    }
    .factors {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 0;
      padding: 0;
      list-style: none;
      font: var(--ds-text-footnote);
    }
    .factors li {
      display: flex;
      justify-content: space-between;
      gap: var(--ds-space-3);
    }
    .impact {
      color: var(--ds-status-critical);
      font-weight: 600;
    }
    @media (prefers-reduced-motion: reduce) {
      .fill {
        transition: none;
      }
    }
  `,
})
export class ProjectHealthCard {
  readonly projectId = input.required<string>();

  private readonly tenant = inject(TenantService);

  readonly health = httpResource<ApiEnvelope<ProjectHealth>>(() =>
    this.tenant.currentId() ? { url: API.projectHealth(this.projectId()), params: { days: 90 } } : undefined,
  );
  protected readonly data = computed(() => (this.health.hasValue() ? this.health.value().data : null));
  protected readonly level = computed(() => HEALTH_LEVEL[this.data()?.level ?? 'good']);
  protected readonly dash = computed(() => ringDash(this.data()?.score ?? 0));
  protected readonly trend = computed(() => (this.data()?.history ?? []).map((p) => ({ date: p.date, value: p.score })));

  protected readonly radius = RADIUS;
  protected readonly scoreFormat = (v: number) => String(Math.round(v));

  protected impactText(impact: number): string {
    return impact > 0 ? `+${impact}` : `−${Math.abs(impact)}`;
  }
}
