import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DsIcon } from 'design-system';
import { PublicReport, ReportData } from '../../core/api/api.types';
import { relativeTime } from '../../core/format/relative-time';
import { ReportView } from './report-view';

/** Tempo de cada seção na tela antes de passar para a próxima. */
export const TV_SECTION_MS = 20_000;
/** Passo do relógio interno (progresso, relógio e "atualizado há"). */
export const TV_TICK_MS = 1_000;

const CLOCK = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Modo TV do relatório (dashboard na parede da agência ou do cliente): uma seção por vez,
 * rotação automática a cada 20 s com indicador de progresso, relógio, tipografia maior e
 * nenhuma ação no caminho. Teclado: ← → trocam de seção, espaço pausa, Esc sai.
 * Com movimento reduzido, a troca é instantânea e a barra de progresso não anima.
 */
@Component({
  selector: 'app-tv-view',
  imports: [ReportView, DsIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'tv',
    '[class.is-reduced]': 'reducedMotion',
    '(document:keydown)': 'onKey($event)',
  },
  template: `
    <header class="bar">
      <div class="who">
        @if (report().agency) {
          <p class="agency">{{ report().agency }}</p>
        }
        <h1 class="title">{{ report().title }}</h1>
        @if (data(); as d) {
          <p class="sub">{{ d.project.name }} · {{ d.period.label }}</p>
        }
      </div>

      <div class="meta">
        @if (report().live) {
          <span class="live" role="status">
            <span class="dot" aria-hidden="true"></span>
            Ao vivo · atualizado {{ refreshedText() }}
          </span>
        }
        @if (sections().length > 1) {
          <span class="count" aria-live="polite">Seção {{ index() + 1 }} de {{ sections().length }}</span>
        }
        <time class="clock" [attr.datetime]="now().toISOString()">{{ clock() }}</time>
      </div>

      <div class="controls">
        <button type="button" class="ctl" (click)="fullscreen()" aria-label="Tela cheia" title="Tela cheia">
          <svg dsIcon="monitor" [size]="18"></svg>
        </button>
        <button
          type="button"
          class="ctl"
          (click)="togglePause()"
          [attr.aria-pressed]="paused()"
          [attr.aria-label]="paused() ? 'Retomar rotação' : 'Pausar rotação'"
          [title]="paused() ? 'Retomar' : 'Pausar'"
        >
          {{ paused() ? '▶' : '❚❚' }}
        </button>
        <button type="button" class="ctl" (click)="exited.emit()" aria-label="Sair do modo TV" title="Sair do modo TV">
          <svg dsIcon="x" [size]="18"></svg>
        </button>
      </div>
    </header>

    @if (sectionData(); as d) {
      @for (view of [d]; track sectionKey()) {
        <div class="stage" animate.enter="tv-enter">
          <app-report-view [data]="view" [showCover]="false" />
        </div>
      }
    } @else {
      <p class="empty">Este relatório ainda não tem seções.</p>
    }

    @if (sections().length > 1) {
      <div
        class="progress"
        role="progressbar"
        aria-label="Tempo até a próxima seção"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-valuenow]="progressPct()"
      >
        <span [style.transform]="'scaleX(' + progress() + ')'"></span>
      </div>
    }
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: var(--ds-z-overlay, 50);
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
      padding: var(--ds-space-6) clamp(16px, 4vw, 64px) var(--ds-space-8);
      overflow: hidden;
      background: var(--ds-bg);
      color: var(--ds-text);
    }
    .bar {
      display: flex;
      align-items: flex-start;
      gap: var(--ds-space-6);
    }
    .who {
      flex: 1;
      min-width: 0;
    }
    .agency {
      margin: 0;
      font: var(--ds-text-footnote);
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ds-text-tertiary);
    }
    .title {
      margin: 2px 0 0;
      font-size: clamp(24px, 2.6vw, 44px);
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }
    .sub {
      margin: 4px 0 0;
      font-size: clamp(14px, 1.2vw, 20px);
      color: var(--ds-text-secondary);
    }
    .meta {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      font-size: clamp(13px, 1vw, 17px);
      color: var(--ds-text-secondary);
    }
    .clock {
      font-size: clamp(28px, 3vw, 52px);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--ds-text);
      line-height: 1;
    }
    .live {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      color: var(--ds-status-healthy);
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--ds-status-healthy);
      animation: tv-pulse 2s ease-in-out infinite;
    }
    .controls {
      display: flex;
      gap: 6px;
      opacity: 0.35;
      transition: opacity 200ms ease;
    }
    .controls:hover,
    .controls:focus-within {
      opacity: 1;
    }
    .ctl {
      display: inline-grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: 50%;
      background: var(--ds-fill);
      color: var(--ds-text);
      font-size: 12px;
      cursor: pointer;
    }
    .stage {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }
    /* Tipografia maior: a tela inteira é lida de longe. */
    @media (min-width: 1280px) {
      .stage {
        zoom: 1.2;
      }
    }
    @media (min-width: 1800px) {
      .stage {
        zoom: 1.45;
      }
    }
    .empty {
      margin: auto;
      font-size: 20px;
      color: var(--ds-text-secondary);
    }
    .progress {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 4px;
      background: var(--ds-fill);
    }
    .progress span {
      display: block;
      height: 100%;
      background: var(--ds-accent);
      transform-origin: left center;
      transition: transform 1s linear;
    }
    :host.is-reduced .progress span,
    :host.is-reduced .controls {
      transition: none;
    }
    :host.is-reduced .dot {
      animation: none;
    }
    @keyframes tv-pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.35;
      }
    }
    .tv-enter {
      animation: tv-fade 500ms ease both;
    }
    :host.is-reduced .tv-enter {
      animation: none;
    }
    @keyframes tv-fade {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
  `,
})
export class TvView {
  readonly report = input.required<PublicReport>();
  readonly exited = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  readonly index = signal(0);
  readonly paused = signal(false);
  readonly elapsed = signal(0);
  readonly now = signal(new Date());

  protected readonly data = computed<ReportData | null>(() => this.report().report);
  readonly sections = computed(() => this.data()?.sections ?? []);
  readonly sectionData = computed<ReportData | null>(() => {
    const data = this.data();
    const sections = this.sections();
    if (!data || sections.length === 0) return null;
    return { ...data, sections: [sections[this.index() % sections.length]] };
  });
  protected readonly sectionKey = computed(() => `${this.index()}:${this.sectionData()?.generated_at ?? ''}`);

  readonly progress = computed(() => Math.min(1, this.elapsed() / TV_SECTION_MS));
  protected readonly progressPct = computed(() => Math.round(this.progress() * 100));
  protected readonly clock = computed(() => CLOCK.format(this.now()));
  protected readonly refreshedText = computed(() => relativeTime(this.report().refreshed_at ?? null, this.now()));

  constructor() {
    const timer = setInterval(() => this.tick(), TV_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));

    // Dados novos (recarga ao vivo) com menos seções: volta para o começo.
    effect(() => {
      const count = this.sections().length;
      if (count > 0 && this.index() >= count) this.index.set(0);
    });
  }

  /** Um passo do relógio: atualiza a hora e, se não estiver pausado, avança a rotação. */
  tick(): void {
    this.now.set(new Date());
    if (this.paused() || this.sections().length < 2) return;
    const next = this.elapsed() + TV_TICK_MS;
    if (next >= TV_SECTION_MS) this.next();
    else this.elapsed.set(next);
  }

  next(): void {
    const count = this.sections().length;
    if (count === 0) return;
    this.index.set((this.index() + 1) % count);
    this.elapsed.set(0);
  }

  previous(): void {
    const count = this.sections().length;
    if (count === 0) return;
    this.index.set((this.index() - 1 + count) % count);
    this.elapsed.set(0);
  }

  togglePause(): void {
    this.paused.update((p) => !p);
  }

  protected onKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowRight':
        this.next();
        break;
      case 'ArrowLeft':
        this.previous();
        break;
      case ' ':
        this.togglePause();
        break;
      case 'Escape':
        this.exited.emit();
        return;
      default:
        return;
    }
    event.preventDefault();
  }

  /** Tela cheia só por gesto do usuário (o navegador exige). */
  async fullscreen(): Promise<void> {
    const el = this.host.nativeElement;
    try {
      if (el.ownerDocument.fullscreenElement) await el.ownerDocument.exitFullscreen();
      else await el.requestFullscreen?.();
    } catch {
      /* navegador sem suporte ou bloqueado: segue em janela */
    }
  }
}
