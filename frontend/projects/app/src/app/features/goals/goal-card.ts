import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsStatusBadge } from 'design-system';
import { Goal } from '../../core/api/api.types';
import { GOAL_STATUS, goalBar, goalTargetText, goalText } from './goals';

/**
 * Uma meta: selo de estado, texto claro, barra de progresso com o marcador do ritmo esperado
 * (métricas que acumulam) ou da meta (métricas de nível), e o andamento do período.
 */
@Component({
  selector: 'app-goal-card',
  imports: [RouterLink, DsStatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="goal" [attr.data-status]="goal().progress.status" [attr.aria-label]="'Meta: ' + text()">
      <header class="head">
        <div class="min-w-0">
          @if (showProject()) {
            <a class="project" [routerLink]="['/projetos', goal().project.id]">{{ goal().project.name }}</a>
          }
          <h3 class="label">{{ goal().progress.label }}</h3>
          <p class="target">Meta: {{ target() }}</p>
        </div>
        @if (meta().level; as level) {
          <ds-status-badge [status]="level" [label]="meta().label" [compact]="true" />
        } @else {
          <span class="chip">{{ meta().label }}</span>
        }
      </header>

      <p class="text">{{ text() }}</p>

      <div
        class="bar"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-valuenow]="pct()"
        [attr.aria-label]="'Progresso da meta ' + goal().progress.label"
      >
        <span class="fill" [class.over]="bar().over" [style.width.%]="bar().fill * 100"></span>
        @if (bar().marker !== null) {
          <span class="marker" [style.left.%]="(bar().marker ?? 0) * 100" [attr.title]="bar().markerLabel"></span>
        }
      </div>

      <footer class="foot">
        @if (bar().marker !== null) {
          <span class="legend"><span class="tick" aria-hidden="true"></span>{{ bar().markerLabel }}</span>
        }
        @if (goal().progress.cumulative && !goal().progress.period.closed) {
          <span>dia {{ goal().progress.days.elapsed }} de {{ goal().progress.days.total }}</span>
        } @else if (goal().progress.period.closed) {
          <span>período encerrado</span>
        }
      </footer>
    </article>
  `,
  styles: `
    .goal {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      padding: var(--ds-space-4);
      border-radius: var(--ds-radius-lg);
      background: var(--ds-fill);
    }
    .head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--ds-space-3);
    }
    .project {
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-accent);
      text-decoration: none;
    }
    .label {
      margin: 0;
      font: var(--ds-text-headline);
    }
    .target {
      margin: 0;
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
    }
    .chip {
      flex: none;
      padding: 2px 10px;
      border-radius: 999px;
      background: var(--ds-bg-elevated);
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .text {
      margin: 0;
      font: var(--ds-text-footnote);
    }
    .bar {
      position: relative;
      height: 10px;
      border-radius: 999px;
      background: var(--ds-bg-elevated);
      overflow: visible;
    }
    .fill {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--goal-color, var(--ds-accent));
      transition: width 600ms var(--ds-ease-out, ease);
    }
    .fill.over {
      background: var(--ds-status-critical);
    }
    .marker {
      position: absolute;
      top: -4px;
      bottom: -4px;
      width: 2px;
      margin-left: -1px;
      border-radius: 1px;
      background: var(--ds-text);
    }
    .foot {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: var(--ds-space-2);
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
    .legend {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .tick {
      width: 2px;
      height: 10px;
      background: var(--ds-text);
    }
    [data-status='off_track'] {
      --goal-color: var(--ds-status-critical);
    }
    [data-status='at_risk'] {
      --goal-color: var(--ds-status-attention);
    }
    [data-status='on_track'],
    [data-status='achieved'] {
      --goal-color: var(--ds-status-healthy);
    }
    [data-status='no_data'] {
      --goal-color: var(--ds-text-tertiary);
    }
    @media (prefers-reduced-motion: reduce) {
      .fill {
        transition: none;
      }
    }
  `,
})
export class GoalCard {
  readonly goal = input.required<Goal>();
  readonly showProject = input(false);

  protected readonly meta = computed(() => GOAL_STATUS[this.goal().progress.status]);
  protected readonly bar = computed(() => goalBar(this.goal().progress, this.goal().comparison));
  protected readonly text = computed(() => goalText(this.goal()));
  protected readonly target = computed(() => {
    const g = this.goal();
    return goalTargetText(g, g.progress.unit, g.progress.decimals);
  });
  protected readonly pct = computed(() => Math.round(this.bar().fill * 100));
}
