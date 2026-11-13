import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DsButton, DsGlassCard, DsIcon, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, Presentation, PresentationVersion } from '../../core/api/api.types';
import { isPlanLimitError } from '../../core/billing/plan-limit';
import { relativeTime } from '../../core/format/relative-time';
import { extractFieldErrors } from '../../core/forms/server-errors';
import { pollWhile } from '../../core/polling/poll-while';
import { pdfFilename, saveBlob } from '../../core/reports/report-pdf';
import { TenantService } from '../../core/tenant/tenant.service';
import { ReportView } from '../reports/report-view';
import {
  FORMAT_TEXT,
  INSTRUCTION_LIMITS,
  STATUS_TEXT,
  STUDIO_POLL_MS,
  aiError,
  blobMessage,
  clampSlide,
  slideCount,
  slideData,
} from './studio';

const EDITABLE_TARGET = /^(INPUT|TEXTAREA|SELECT)$/;

/**
 * /studio/:id — apresentação do Studio (ADR 0029): visualização (slides com teclado e tela cheia,
 * ou página contínua), ajustes por chat (cada um vira uma versão), versões, PDF e título.
 */
@Component({
  selector: 'app-presentation-page',
  imports: [FormsModule, RouterLink, DsButton, DsGlassCard, DsIcon, DsSkeleton, ReportView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './studio.css',
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    <header class="mb-6">
      <a routerLink="/studio" class="back text-footnote">← Studio</a>
    </header>

    @if (loading()) {
      <ds-glass-card padding="lg"><ds-skeleton width="50%" /><div class="mt-3"><ds-skeleton width="80%" /></div></ds-glass-card>
    } @else if (loadError()) {
      <ds-glass-card padding="lg" role="alert">
        <p class="m-0">{{ loadError() }}</p>
        <button ds-button variant="secondary" size="sm" class="mt-3" (click)="load()">Tentar de novo</button>
      </ds-glass-card>
    } @else if (presentation(); as p) {
      <div class="top">
        <div class="min-w-0 flex-1">
          @if (editingTitle()) {
            <form class="title-form" (submit)="$event.preventDefault(); saveTitle()">
              <label class="sr-only" for="presentation-title">Título da apresentação</label>
              <input id="presentation-title" class="title-input" name="title" maxlength="160" [ngModel]="titleDraft()" (ngModelChange)="titleDraft.set($event)" />
              <button ds-button size="sm" type="submit" [loading]="busy() === 'title'">Salvar</button>
              <button ds-button size="sm" variant="ghost" type="button" (click)="editingTitle.set(false)">Cancelar</button>
            </form>
            @if (titleError()) {
              <small class="error" role="alert">{{ titleError() }}</small>
            }
          } @else {
            <h1 class="m-0 text-title-1 font-bold tracking-tight">
              {{ p.title }}
              <button type="button" class="link-btn" (click)="startTitle(p.title)" aria-label="Renomear a apresentação">Renomear</button>
            </h1>
          }
          <p class="m-0 mt-1 text-footnote text-fg-muted">
            {{ p.project.name ?? 'Projeto' }} · {{ formatText(p.format) }}
            <span class="badge" [class]="'badge is-' + p.status">{{ statusText(p.status) }}</span>
            @if (p.current_version > 0) {
              · versão {{ p.current_version }}
            }
          </p>
        </div>
        <div class="actions">
          @if (p.format === 'slides' && shown()) {
            <button ds-button variant="secondary" size="sm" (click)="fullscreen()"><svg dsIcon="maximize" [size]="14"></svg> Tela cheia</button>
          }
          @if (p.current_version > 0) {
            <button ds-button variant="secondary" size="sm" [loading]="busy() === 'pdf'" (click)="downloadPdf(p)"><svg dsIcon="download" [size]="14"></svg> Baixar PDF</button>
          }
          @if (confirmDelete()) {
            <span class="text-footnote">Excluir a apresentação e todas as versões?</span>
            <button ds-button variant="ghost" size="sm" (click)="confirmDelete.set(false)">Cancelar</button>
            <button ds-button variant="destructive" size="sm" [loading]="busy() === 'delete'" (click)="remove(p)">Excluir</button>
          } @else {
            <button ds-button variant="ghost" size="sm" (click)="confirmDelete.set(true)">Excluir</button>
          }
        </div>
      </div>

      <p class="m-0 mb-4 text-footnote text-fg-muted explain">
        A IA escolhe as métricas e escreve a narrativa; os números são calculados pelo Delta com os dados do projeto.
      </p>

      <div class="layout">
        <section class="stage" aria-label="Apresentação">
          @if (p.status === 'generating' && !shown()) {
            <ds-glass-card padding="lg" data-testid="studio-generating">
              <div class="note" role="status" aria-live="polite">
                <span class="spinner" aria-hidden="true"></span>
                <div>
                  <p class="m-0 text-headline">Gerando a apresentação…</p>
                  <p class="m-0 mt-1 text-footnote text-fg-muted">Costuma levar de 10 a 60 segundos. Pode continuar navegando: ela aparece aqui quando ficar pronta.</p>
                </div>
              </div>
            </ds-glass-card>
          } @else if (p.status === 'error' && !shown()) {
            <ds-glass-card padding="lg" role="alert" data-testid="studio-error">
              <p class="m-0 text-headline">Não foi possível gerar a apresentação.</p>
              <p class="m-0 mt-2 text-footnote">{{ p.error ?? 'Tente de novo em instantes.' }}</p>
              <button ds-button size="sm" class="mt-4" [loading]="busy() === 'retry'" (click)="retry(p)">Tentar de novo</button>
            </ds-glass-card>
          } @else if (shown(); as v) {
            @if (p.status === 'generating') {
              <p class="m-0 mb-3 text-footnote" role="status" aria-live="polite" data-testid="studio-revising">
                <span class="spinner sm" aria-hidden="true"></span> Gerando uma nova versão com o seu ajuste…
              </p>
            }
            @if (p.status === 'error' && p.error) {
              <p class="m-0 mb-3 error-box" role="alert">O último ajuste falhou: {{ p.error }}</p>
            }
            @if (viewing(); as old) {
              <div class="m-0 mb-3 warn-box viewing" data-testid="studio-viewing-old">
                <span>Você está vendo a versão {{ old.number }} (a atual é a {{ p.current_version }}).</span>
                <button type="button" class="link-btn" (click)="viewing.set(null)">Ver a atual</button>
                <button type="button" class="link-btn" [disabled]="busy() === 'restore'" (click)="restore(p, old.number)">Voltar para esta</button>
              </div>
            }
            @if (v.unverified_numbers.length > 0) {
              <div class="m-0 mb-3 warn-box" role="alert" data-testid="studio-unverified">
                <strong>Confira antes de enviar:</strong> estes números do texto não batem com os dados do projeto:
                {{ v.unverified_numbers.join(', ') }}.
              </div>
            }

            @if (p.format === 'slides') {
              <div class="deck" #deck tabindex="0" aria-roledescription="apresentação de slides" [attr.aria-label]="'Slide ' + (slide() + 1) + ' de ' + count()">
                <div class="slide" aria-live="polite">
                  <app-report-view [data]="current()!" [showCover]="slide() === 0" />
                </div>
                <div class="deck-nav">
                  <button ds-button variant="secondary" size="sm" (click)="go(-1)" [disabled]="slide() === 0" aria-label="Slide anterior">
                    <svg dsIcon="chevron-left" [size]="16"></svg>
                  </button>
                  <span class="text-footnote" data-testid="slide-counter">{{ slide() + 1 }} / {{ count() }}</span>
                  <button ds-button variant="secondary" size="sm" (click)="go(1)" [disabled]="slide() >= count() - 1" aria-label="Próximo slide">
                    <svg dsIcon="chevron-right" [size]="16"></svg>
                  </button>
                </div>
                <p class="m-0 text-caption text-fg-muted kbd-hint">Use as setas ← → do teclado para trocar de slide.</p>
              </div>
            } @else {
              <app-report-view [data]="v.rendered" />
            }
          }
        </section>

        <aside class="side">
          <ds-glass-card padding="lg">
            <h2 class="m-0 text-headline">Ajustar conversando</h2>
            <p class="m-0 mt-1 text-footnote text-fg-muted">Peça mudanças em linguagem natural. Cada ajuste vira uma versão nova.</p>
            <form class="form" (submit)="$event.preventDefault(); revise(p)" novalidate aria-label="Pedir ajuste">
              <label class="field">
                <span class="sr-only">Ajuste</span>
                <textarea
                  name="instruction"
                  rows="3"
                  [maxlength]="instructionLimits.max"
                  placeholder="Ex.: deixe mais curto, com um slide só sobre o Instagram"
                  [ngModel]="instruction()"
                  (ngModelChange)="instruction.set($event)"
                  [disabled]="p.status === 'generating' || p.current_version === 0"
                ></textarea>
                @if (reviseError()) {
                  <small class="error" role="alert">{{ reviseError() }}</small>
                }
              </label>
              <div class="actions">
                <button ds-button size="sm" type="submit" [loading]="busy() === 'revise'" [disabled]="p.status === 'generating' || p.current_version === 0 || busy() === 'revise'">
                  <svg dsIcon="sparkles" [size]="14"></svg> Ajustar
                </button>
              </div>
            </form>
          </ds-glass-card>

          <ds-glass-card padding="lg" data-testid="studio-versions">
            <h2 class="m-0 text-headline">Versões</h2>
            @if (p.versions.length === 0) {
              <p class="m-0 mt-2 text-footnote text-fg-muted">Nenhuma versão ainda.</p>
            } @else {
              <ol class="versions" aria-label="Versões" reversed>
                @for (ver of versionsDesc(); track ver.number) {
                  <li [class.is-current]="ver.number === p.current_version">
                    <div class="min-w-0 flex-1">
                      <strong class="text-subhead">Versão {{ ver.number }}</strong>
                      @if (ver.number === p.current_version) {<span class="badge is-ready">atual</span>}
                      @if (!ver.verified) {<span class="badge">números a conferir</span>}
                      <p class="m-0 text-caption text-fg-muted instr">{{ ver.instruction }}</p>
                      <p class="m-0 text-caption text-fg-muted">{{ ago(ver.created_at) }}</p>
                    </div>
                    @if (ver.number !== p.current_version) {
                      <div class="ver-actions">
                        <button type="button" class="link-btn" (click)="viewVersion(p, ver.number)" [attr.aria-label]="'Ver a versão ' + ver.number">Ver</button>
                        <button type="button" class="link-btn" [disabled]="busy() === 'restore'" (click)="restore(p, ver.number)" [attr.aria-label]="'Voltar para a versão ' + ver.number">Voltar para esta</button>
                      </div>
                    }
                  </li>
                }
              </ol>
            }
          </ds-glass-card>

          <ds-glass-card padding="md">
            <p class="m-0 text-caption text-fg-muted"><strong>Pedido original:</strong> {{ p.brief }}</p>
          </ds-glass-card>
        </aside>
      </div>
    }
  `,
  styles: `
    .back { color: var(--ds-accent); text-decoration: none; }
    .top { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--ds-space-4); margin-bottom: var(--ds-space-3); }
    .title-form { display: flex; flex-wrap: wrap; gap: var(--ds-space-2); align-items: center; }
    .title-input {
      flex: 1 1 260px; min-height: 40px; padding: 6px 10px; border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md); background: var(--ds-bg-elevated); color: var(--ds-text); font: var(--ds-text-title-3);
    }
    .link-btn {
      padding: 0; border: 0; background: none; color: var(--ds-accent); font: var(--ds-text-footnote); font-weight: 600; cursor: pointer;
    }
    .link-btn:disabled { opacity: 0.5; cursor: default; }
    h1 .link-btn { margin-left: var(--ds-space-2); vertical-align: middle; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--ds-space-5); align-items: start; }
    @media (max-width: 1024px) { .layout { grid-template-columns: 1fr; } }
    .side { display: flex; flex-direction: column; gap: var(--ds-space-4); }
    .deck { display: flex; flex-direction: column; gap: var(--ds-space-3); border-radius: var(--ds-radius-xl); outline: none; }
    .deck:focus-visible { outline: 2px solid var(--ds-accent); outline-offset: 4px; }
    .deck:fullscreen { justify-content: center; padding: var(--ds-space-8); background: var(--ds-bg); overflow: auto; }
    .slide { min-height: 360px; }
    .deck-nav { display: flex; align-items: center; justify-content: center; gap: var(--ds-space-3); }
    .kbd-hint { text-align: center; }
    .versions { list-style: none; margin: var(--ds-space-3) 0 0; padding: 0; display: flex; flex-direction: column; }
    .versions li { display: flex; gap: var(--ds-space-2); padding: var(--ds-space-3) 0; border-bottom: 1px solid var(--ds-separator); }
    .versions li.is-current strong { color: var(--ds-accent); }
    .instr { overflow-wrap: anywhere; }
    .ver-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .viewing { display: flex; flex-wrap: wrap; gap: var(--ds-space-3); align-items: center; }
    .spinner {
      display: inline-block; width: 22px; height: 22px; border-radius: 50%; flex: none;
      border: 3px solid color-mix(in oklch, var(--ds-accent) 25%, transparent); border-top-color: var(--ds-accent);
      animation: studio-spin 0.9s linear infinite;
    }
    .spinner.sm { width: 12px; height: 12px; border-width: 2px; vertical-align: -1px; }
    @keyframes studio-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  `,
})
export class PresentationPage {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(DsToastService);
  private readonly tenant = inject(TenantService);

  readonly id = input.required<string>();

  protected readonly presentation = signal<Presentation | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  /** Versão antiga aberta para olhar (null = a atual). */
  protected readonly viewing = signal<PresentationVersion | null>(null);
  protected readonly slide = signal(0);
  protected readonly busy = signal<string | null>(null);
  protected readonly instruction = signal('');
  protected readonly reviseError = signal<string | null>(null);
  protected readonly editingTitle = signal(false);
  protected readonly titleDraft = signal('');
  protected readonly titleError = signal<string | null>(null);
  protected readonly confirmDelete = signal(false);

  protected readonly instructionLimits = INSTRUCTION_LIMITS;
  private readonly deck = viewChild<ElementRef<HTMLElement>>('deck');

  protected readonly shown = computed(() => this.viewing() ?? this.presentation()?.version ?? null);
  protected readonly count = computed(() => slideCount(this.shown()?.rendered ?? null));
  protected readonly current = computed(() => {
    const v = this.shown();
    return v ? slideData(v.rendered, this.slide()) : null;
  });
  protected readonly versionsDesc = computed(() => [...(this.presentation()?.versions ?? [])].sort((a, b) => b.number - a.number));
  private readonly generating = computed(() => this.presentation()?.status === 'generating');

  constructor() {
    // Recarrega quando a rota troca de apresentação (ou a agência muda).
    effect(() => {
      const id = this.id();
      this.tenant.currentId();
      untracked(() => {
        this.viewing.set(null);
        this.slide.set(0);
        void this.load(id);
      });
    });
    // Enquanto a IA gera, consulta a cada 3 s.
    pollWhile(() => this.generating(), () => void this.refresh(), STUDIO_POLL_MS);
  }

  async load(id: string = this.id()): Promise<void> {
    this.loading.set(this.presentation()?.id !== id);
    this.loadError.set(null);
    try {
      const res = await firstValueFrom(this.http.get<ApiEnvelope<Presentation>>(API.presentation(id)));
      this.apply(res.data);
    } catch (error) {
      this.loadError.set(error instanceof HttpErrorResponse && error.status === 404 ? 'Apresentação não encontrada.' : 'Não foi possível carregar a apresentação.');
    } finally {
      this.loading.set(false);
    }
  }

  private async refresh(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiEnvelope<Presentation>>(API.presentation(this.id())));
      this.apply(res.data);
    } catch {
      /* próxima consulta tenta de novo */
    }
  }

  private apply(p: Presentation): void {
    const before = this.presentation();
    this.presentation.set(p);
    if (before && before.current_version !== p.current_version) {
      this.slide.set(0);
      this.viewing.set(null);
    } else {
      this.slide.update((s) => clampSlide(s, slideCount((this.viewing() ?? p.version)?.rendered ?? null)));
    }
  }

  protected go(delta: number): void {
    this.slide.update((s) => clampSlide(s + delta, this.count()));
  }

  protected onKey(event: KeyboardEvent): void {
    if (this.presentation()?.format !== 'slides' || !this.shown()) return;
    const target = event.target as HTMLElement | null;
    if (target && (EDITABLE_TARGET.test(target.tagName) || target.isContentEditable)) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') {
      this.go(1);
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      this.go(-1);
      event.preventDefault();
    } else if (event.key === 'Home') {
      this.slide.set(0);
    } else if (event.key === 'End') {
      this.slide.set(Math.max(0, this.count() - 1));
    }
  }

  /** Tela cheia só por gesto do usuário (o navegador exige). */
  protected async fullscreen(): Promise<void> {
    const el = this.deck()?.nativeElement;
    if (!el) return;
    try {
      if (el.ownerDocument.fullscreenElement) await el.ownerDocument.exitFullscreen();
      else await el.requestFullscreen?.();
      el.focus();
    } catch {
      /* navegador sem suporte: segue em janela */
    }
  }

  protected async revise(p: Presentation): Promise<void> {
    const text = this.instruction().trim();
    if (text.length < INSTRUCTION_LIMITS.min) {
      this.reviseError.set('Diga o que ajustar (pelo menos 3 caracteres).');
      return;
    }
    this.reviseError.set(null);
    this.busy.set('revise');
    try {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<Presentation>>(API.presentationRevise(p.id), { instruction: text }));
      this.instruction.set('');
      this.viewing.set(null);
      this.apply(res.data);
    } catch (error) {
      if (isPlanLimitError(error)) return;
      this.reviseError.set(aiError(error) ?? extractFieldErrors(error)?.['instruction'] ?? 'Não foi possível pedir o ajuste agora.');
    } finally {
      this.busy.set(null);
    }
  }

  protected async viewVersion(p: Presentation, n: number): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiEnvelope<Presentation>>(API.presentationVersion(p.id, n)));
      this.viewing.set(res.data.version);
      this.slide.set(0);
    } catch {
      this.toast.error('Não foi possível abrir essa versão');
    }
  }

  protected async restore(p: Presentation, n: number): Promise<void> {
    this.busy.set('restore');
    try {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<Presentation>>(API.presentationRestore(p.id), { number: n }));
      this.viewing.set(null);
      this.apply(res.data);
      this.slide.set(0);
      this.toast.success(`Versão ${n} restaurada`);
    } catch {
      this.toast.error('Não foi possível voltar para essa versão');
    } finally {
      this.busy.set(null);
    }
  }

  protected async retry(p: Presentation): Promise<void> {
    this.busy.set('retry');
    try {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<Presentation>>(API.presentationRetry(p.id), {}));
      this.apply(res.data);
    } catch (error) {
      if (isPlanLimitError(error)) return;
      this.toast.error('Não foi possível tentar de novo', { message: aiError(error) ?? undefined });
    } finally {
      this.busy.set(null);
    }
  }

  protected startTitle(title: string): void {
    this.titleDraft.set(title);
    this.titleError.set(null);
    this.editingTitle.set(true);
  }

  protected async saveTitle(): Promise<void> {
    const p = this.presentation();
    const title = this.titleDraft().trim();
    if (!p) return;
    if (!title) {
      this.titleError.set('Dê um título.');
      return;
    }
    this.busy.set('title');
    try {
      const res = await firstValueFrom(this.http.patch<ApiEnvelope<Presentation>>(API.presentation(p.id), { title }));
      this.presentation.set(res.data);
      this.editingTitle.set(false);
    } catch (error) {
      this.titleError.set(extractFieldErrors(error)?.['title'] ?? 'Não foi possível salvar o título.');
    } finally {
      this.busy.set(null);
    }
  }

  protected async remove(p: Presentation): Promise<void> {
    this.busy.set('delete');
    try {
      await firstValueFrom(this.http.delete(API.presentation(p.id)));
      this.toast.success('Apresentação excluída');
      await this.router.navigateByUrl('/studio');
    } catch {
      this.toast.error('Não foi possível excluir');
    } finally {
      this.busy.set(null);
    }
  }

  protected async downloadPdf(p: Presentation): Promise<void> {
    this.busy.set('pdf');
    try {
      const res = await firstValueFrom(this.http.get(API.presentationPdf(p.id), { observe: 'response', responseType: 'blob' }));
      if (res.body) saveBlob(res.body, pdfFilename(p.title || 'apresentacao'));
    } catch (error) {
      // 5xx e rede já viram aviso no interceptor; 409 = ainda não há versão pronta.
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.toast.error('Não foi possível gerar o PDF', { message: (await blobMessage(error.error)) ?? undefined });
      } else if (!(error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500))) {
        this.toast.error('Não foi possível baixar o PDF');
      }
    } finally {
      this.busy.set(null);
    }
  }

  protected formatText(format: Presentation['format']): string {
    return FORMAT_TEXT[format];
  }

  protected statusText(status: Presentation['status']): string {
    return STATUS_TEXT[status];
  }

  protected ago(iso: string): string {
    return relativeTime(iso);
  }
}
