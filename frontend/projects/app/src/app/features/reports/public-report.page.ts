import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { LucideDownload, LucideLock } from '@lucide/angular';
import { DsButton, DsIcon, DsSkeleton } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, PublicReport, PublicReportLocked } from '../../core/api/api.types';
import { extractFieldErrors } from '../../core/forms/server-errors';
import { relativeTime } from '../../core/format/relative-time';
import { ReportPdfService } from '../../core/reports/report-pdf';
import { DeltaLogo } from '../auth/delta-logo';
import { ReportView } from './report-view';
import { TvView } from './tv-view';

/** Dashboard ao vivo: o backend recalcula com cache de 5 min; a página busca de novo no mesmo ritmo. */
export const LIVE_REFRESH_MS = 5 * 60_000;

type State =
  | { kind: 'loading' }
  | { kind: 'locked'; title: string; agency: string | null }
  | { kind: 'ready'; report: PublicReport }
  | { kind: 'gone'; message: string }
  | { kind: 'missing' }
  | { kind: 'error' };

/**
 * Relatório aberto por link público (sem login). Rota: /r/:token
 * Link com senha: o backend responde 401 e os dados só vêm depois do "unlock".
 * Link ao vivo (dashboard): selo "Ao vivo", recarga silenciosa a cada 5 min e sem PDF.
 * Modo TV: /r/:token?tv=1 (ou o botão "Modo TV").
 */
@Component({
  selector: 'app-public-report-page',
  imports: [DsButton, DsIcon, DsSkeleton, DeltaLogo, ReportView, TvView, LucideDownload, LucideLock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" [style.--ds-accent]="branding()?.color ?? null">
      @switch (state().kind) {
        @case ('loading') {
          <div class="loading" aria-busy="true">
            <ds-skeleton height="180px" radius="var(--ds-radius-xl)" />
            <ds-skeleton width="40%" height="20px" />
            <ds-skeleton height="140px" radius="var(--ds-radius-lg)" />
          </div>
        }
        @case ('locked') {
          @let s = locked();
          <form class="lock ds-glass" aria-label="Senha do relatório" (submit)="$event.preventDefault(); unlock()" animate.enter="ds-enter-fade-up">
            <span class="lock-icon" aria-hidden="true"><svg lucideLock [size]="22"></svg></span>
            @if (s?.agency) {
              <p class="m-0 text-footnote font-semibold uppercase tracking-wider text-fg-subtle">{{ s?.agency }}</p>
            }
            <h1 class="m-0 text-title-2 font-bold">{{ s?.title }}</h1>
            <p class="m-0 text-footnote text-fg-muted">Este relatório é protegido. Digite a senha que a agência enviou.</p>
            <label class="field">
              <span class="ds-visually-hidden">Senha</span>
              <input
                type="password"
                name="report_password"
                autocomplete="current-password"
                placeholder="Senha"
                [value]="password()"
                (input)="password.set($any($event.target).value); passwordError.set(null)"
              />
            </label>
            @if (passwordError()) {
              <p class="error" role="alert">{{ passwordError() }}</p>
            }
            <button ds-button type="submit" [loading]="unlocking()" [block]="true">Abrir relatório</button>
          </form>
        }
        @case ('ready') {
          @let r = ready();
          @if (r) {
            @if (tvOn()) {
              <app-tv-view [report]="r" (exited)="setTv(false)" />
            } @else {
              <div class="bar">
                @if (r.branding?.logo_url; as logo) {
                  <img class="brand-logo" [src]="logo" [alt]="r.branding?.name ?? 'Logo da agência'" />
                }
                @if (r.live) {
                  <span class="live" role="status">
                    <span class="dot" aria-hidden="true"></span>
                    Ao vivo · atualizado {{ refreshedText() }}
                  </span>
                }
                <span class="spacer"></span>
                <button ds-button variant="ghost" size="sm" (click)="setTv(true)">
                  <svg dsIcon="tv" [size]="14"></svg>
                  Modo TV
                </button>
                @if (!r.live && r.pdf_url) {
                  <button ds-button variant="secondary" size="sm" [loading]="downloading()" (click)="download(r)">
                    <svg lucideDownload [size]="14"></svg>
                    Baixar PDF
                  </button>
                }
              </div>
              @if (r.report) {
                <app-report-view [data]="r.report" [brand]="r.branding ?? null" />
              }
            }
          }
        }
        @case ('gone') {
          <div class="state ds-glass" role="alert">
            <p class="m-0 text-headline">Relatório indisponível</p>
            <p class="m-0 text-footnote text-fg-muted">{{ goneMessage() }}</p>
          </div>
        }
        @case ('missing') {
          <div class="state ds-glass" role="alert">
            <p class="m-0 text-headline">Relatório não encontrado</p>
            <p class="m-0 text-footnote text-fg-muted">Confira se o link foi copiado inteiro.</p>
          </div>
        }
        @default {
          <div class="state ds-glass" role="alert">
            <p class="m-0 text-headline">Não foi possível abrir o relatório agora.</p>
            <button ds-button variant="secondary" size="sm" (click)="load()">Tentar de novo</button>
          </div>
        }
      }

      @if (!tvOn() && !branding()?.hide_delta_badge) {
        <footer class="made">
          <app-delta-logo [size]="16" />
          Feito com Delta
        </footer>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
      background: var(--ds-bg);
      color: var(--ds-text);
    }
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-5);
      max-width: 1040px;
      margin: 0 auto;
      padding: var(--ds-space-8) var(--ds-space-4) var(--ds-space-6);
    }
    .loading {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    .bar {
      display: flex;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .spacer {
      flex: 1;
    }
    .brand-logo {
      max-width: 140px;
      max-height: 36px;
      object-fit: contain;
    }
    .live {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font: var(--ds-text-footnote);
      font-weight: 600;
      color: var(--ds-status-healthy);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--ds-status-healthy);
      animation: live-pulse 2s ease-in-out infinite;
    }
    @keyframes live-pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.35;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .dot {
        animation: none;
      }
    }
    .lock {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--ds-space-3);
      width: min(420px, 100%);
      margin: 10vh auto 0;
      padding: var(--ds-space-8) var(--ds-space-6);
      border-radius: var(--ds-radius-xl);
      text-align: center;
    }
    .lock-icon {
      display: inline-grid;
      place-items: center;
      width: 52px;
      height: 52px;
      border-radius: 16px;
      background: var(--ds-accent-soft, var(--ds-fill));
      color: var(--ds-accent);
    }
    .field {
      width: 100%;
    }
    .field input {
      width: 100%;
      height: 42px;
      padding: 0 12px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-body);
    }
    .error {
      margin: 0;
      font: var(--ds-text-footnote);
      color: var(--ds-status-critical);
    }
    .state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--ds-space-2);
      margin-top: 10vh;
      padding: var(--ds-space-10) var(--ds-space-6);
      border-radius: var(--ds-radius-xl);
      text-align: center;
    }
    .made {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: var(--ds-space-6);
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
    @media print {
      .bar,
      .made {
        display: none;
      }
    }
  `,
})
export class PublicReportPage implements OnInit {
  readonly token = input.required<string>();
  /** Query param ?tv=1 (withComponentInputBinding). */
  readonly tv = input<string | undefined>(undefined);

  private readonly http = inject(HttpClient);
  private readonly pdf = inject(ReportPdfService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly state = signal<State>({ kind: 'loading' });
  protected readonly password = signal('');
  protected readonly passwordError = signal<string | null>(null);
  protected readonly unlocking = signal(false);
  protected readonly downloading = signal(false);

  /** Modo TV: começa pelo ?tv=1 e liga/desliga pelo botão. */
  readonly tvOn = linkedSignal(() => this.tv() === '1' || this.tv() === 'true');
  /** Relógio para o "atualizado há X" (atualiza a cada 30 s). */
  private readonly now = signal(new Date());
  protected readonly refreshedText = computed(() => {
    const r = this.ready();
    return relativeTime(r?.refreshed_at ?? r?.published_at ?? null, this.now());
  });
  /** Senha aceita no "unlock", só em memória: a recarga ao vivo de link protegido precisa dela. */
  private unlockedWith: string | null = null;

  /** Marca da agência dona do relatório (white label). */
  protected readonly branding = computed(() => this.ready()?.branding ?? null);

  protected locked(): { title: string; agency: string | null } | null {
    const s = this.state();
    return s.kind === 'locked' ? s : null;
  }

  protected ready(): PublicReport | null {
    const s = this.state();
    return s.kind === 'ready' ? s.report : null;
  }

  protected goneMessage(): string {
    const s = this.state();
    return s.kind === 'gone' ? s.message : '';
  }

  ngOnInit(): void {
    this.useTheme();
    void this.load();

    const clock = setInterval(() => this.now.set(new Date()), 30_000);
    const live = setInterval(() => {
      if (this.ready()?.live) void this.refresh();
    }, LIVE_REFRESH_MS);
    this.destroyRef.onDestroy(() => {
      clearInterval(clock);
      clearInterval(live);
    });
  }

  /**
   * Tema claro para quem recebe o link (escuro no modo TV), sem mexer na preferência salva de
   * quem usa o Delta: o tema anterior volta ao sair da página.
   */
  private useTheme(): void {
    const root = this.document.documentElement;
    const previous = root.getAttribute('data-theme');
    root.setAttribute('data-theme', this.tvOn() ? 'dark' : 'light');
    this.destroyRef.onDestroy(() => {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    });
  }

  setTv(on: boolean): void {
    this.tvOn.set(on);
    this.document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light');
    const view = this.document.defaultView;
    try {
      const url = new URL(view?.location.href ?? '');
      if (on) url.searchParams.set('tv', '1');
      else url.searchParams.delete('tv');
      view?.history.replaceState(view.history.state, '', url.pathname + url.search);
    } catch {
      /* ambiente sem location (testes): o estado local basta */
    }
  }

  /** Recarga silenciosa do dashboard ao vivo: mantém os números na tela se a rede falhar. */
  async refresh(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.unlockedWith === null
          ? this.http.get<ApiEnvelope<PublicReport>>(API.publicReport(this.token()))
          : this.http.post<ApiEnvelope<PublicReport>>(API.publicReportUnlock(this.token()), { password: this.unlockedWith }),
      );
      this.state.set({ kind: 'ready', report: res.data });
      this.now.set(new Date());
    } catch (error) {
      const next = this.failure(error);
      // Link desativado/expirado no meio da exibição: mostra o motivo. Rede/servidor: segue com o que tem.
      if (next.kind === 'gone' || next.kind === 'missing') this.state.set(next);
    }
  }

  async load(): Promise<void> {
    this.state.set({ kind: 'loading' });
    try {
      const res = await firstValueFrom(this.http.get<ApiEnvelope<PublicReport>>(API.publicReport(this.token())));
      this.state.set({ kind: 'ready', report: res.data });
    } catch (error) {
      this.state.set(this.failure(error));
    }
  }

  async unlock(): Promise<void> {
    if (this.unlocking()) return;
    if (!this.password()) {
      this.passwordError.set('Digite a senha do relatório.');
      return;
    }
    this.unlocking.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiEnvelope<PublicReport>>(API.publicReportUnlock(this.token()), { password: this.password() }),
      );
      this.unlockedWith = res.data.live ? this.password() : null;
      this.password.set('');
      this.state.set({ kind: 'ready', report: res.data });
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) {
        this.passwordError.set(fields['password'] ?? 'Senha incorreta.');
      } else {
        this.state.set(this.failure(error));
      }
    } finally {
      this.unlocking.set(false);
    }
  }

  protected async download(report: PublicReport): Promise<void> {
    if (!report.pdf_url) return;
    this.downloading.set(true);
    try {
      await this.pdf.public(report.pdf_url, report.title);
    } finally {
      this.downloading.set(false);
    }
  }

  private failure(error: unknown): State {
    if (!(error instanceof HttpErrorResponse)) return { kind: 'error' };
    if (error.status === 401) {
      const body = error.error as Partial<PublicReportLocked> | null;
      return { kind: 'locked', title: body?.title ?? 'Relatório', agency: body?.agency ?? null };
    }
    if (error.status === 410) {
      const message = (error.error as { message?: string } | null)?.message;
      return { kind: 'gone', message: message ?? 'Este link não está mais disponível.' };
    }
    if (error.status === 404) return { kind: 'missing' };
    return { kind: 'error' };
  }
}
