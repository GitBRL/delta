import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { LucideCircleCheck, LucideMessageSquare } from '@lucide/angular';
import { DsButton, DsSkeleton } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, ApprovalDecisionBody, PublicApproval } from '../../core/api/api.types';
import { extractFieldErrors } from '../../core/forms/server-errors';
import { DeltaLogo } from '../auth/delta-logo';
import { ProviderIcon } from '../integrations/provider-icon';
import { formatDateTime, formatLongDateTime, formatText } from './publishing';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: PublicApproval }
  | { kind: 'missing' }
  | { kind: 'error' };

/**
 * Aprovação de post pelo cliente, por link público (ADR 0028). Rota: /aprovar/:token
 * Sem login. Mobile-first: o cliente abre pelo WhatsApp ou pelo e-mail.
 */
@Component({
  selector: 'app-approval-page',
  imports: [DsButton, DsSkeleton, DeltaLogo, ProviderIcon, LucideCircleCheck, LucideMessageSquare],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" [style.--ds-accent]="brand()?.color ?? null">
      @switch (state().kind) {
        @case ('loading') {
          <div class="stack" aria-busy="true">
            <ds-skeleton width="40%" height="20px" />
            <ds-skeleton height="320px" radius="var(--ds-radius-xl)" />
            <ds-skeleton width="80%" />
          </div>
        }
        @case ('missing') {
          <div class="state ds-glass" role="alert">
            <p class="m-0 text-headline">Link de aprovação inválido</p>
            <p class="m-0 text-footnote text-fg-muted">Confira se o link foi copiado inteiro ou peça um novo à agência.</p>
          </div>
        }
        @case ('error') {
          <div class="state ds-glass" role="alert">
            <p class="m-0 text-headline">Não foi possível abrir agora.</p>
            <button ds-button variant="secondary" size="sm" (click)="load()">Tentar de novo</button>
          </div>
        }
        @default {
          @if (data(); as d) {
            <header class="brand">
              @if (d.brand.logo_url) {
                <img class="logo" [src]="d.brand.logo_url" [alt]="d.brand.name" />
              } @else {
                <span class="agency text-subhead font-semibold">{{ d.brand.name }}</span>
              }
            </header>

            <div class="intro">
              <p class="m-0 text-footnote font-semibold uppercase tracking-wider text-fg-subtle">{{ d.project.name }}</p>
              <h1 class="m-0 text-title-2 font-bold">{{ d.post.title || 'Post para aprovação' }}</h1>
              <ul class="where" aria-label="Onde vai sair">
                @for (t of d.post.targets; track $index) {
                  <li>
                    <app-provider-icon [provider]="t.network" [size]="14" />
                    {{ t.network_label }} · {{ formatLabel(t.format) }}{{ t.account ? ' · ' + t.account : '' }}
                  </li>
                }
              </ul>
              @if (d.post.scheduled_at) {
                <p class="m-0 text-footnote text-fg-muted">Previsto para {{ longDate(d.post.scheduled_at) }}.</p>
              }
            </div>

            @if (d.post.media.length > 0) {
              <div class="media" [class.single]="d.post.media.length === 1" role="list" aria-label="Mídias do post">
                @for (m of d.post.media; track m.id; let i = $index) {
                  <figure class="slide" role="listitem">
                    @if (m.kind === 'image') {
                      <img [src]="m.url" [alt]="'Imagem ' + (i + 1) + ' de ' + d.post.media.length" />
                    } @else {
                      <video [src]="m.url" controls playsinline preload="metadata" [attr.aria-label]="'Vídeo ' + (i + 1) + ' de ' + d.post.media.length"></video>
                    }
                    @if (d.post.media.length > 1) {
                      <figcaption class="text-caption text-fg-muted">{{ i + 1 }} de {{ d.post.media.length }}</figcaption>
                    }
                  </figure>
                }
              </div>
            }

            @if (d.post.caption.trim()) {
              <section class="caption ds-glass" aria-label="Legenda">
                <p class="m-0 text-body">{{ d.post.caption }}</p>
              </section>
            }

            @if (done(); as decision) {
              <section class="answer ds-glass" role="status" data-testid="done">
                <svg lucideCircleCheck [size]="28" aria-hidden="true"></svg>
                <p class="m-0 text-headline">{{ decision === 'approved' ? 'Obrigado! Post aprovado.' : 'Obrigado! A agência vai ajustar o post.' }}</p>
                <p class="m-0 text-footnote text-fg-muted">Pode fechar esta página.</p>
              </section>
            } @else {
              @switch (d.approval.state) {
                @case ('decided') {
                  <section class="answer ds-glass" role="status" data-testid="decided">
                    <p class="m-0 text-headline">
                      {{ d.approval.decision === 'approved' ? 'Este post já foi aprovado.' : 'Você já pediu ajustes neste post.' }}
                    </p>
                    @if (d.approval.comment) {
                      <blockquote class="comment text-footnote">{{ d.approval.comment }}</blockquote>
                    }
                    <p class="m-0 text-footnote text-fg-muted">Resposta em {{ dateTime(d.approval.decided_at) }}.</p>
                  </section>
                }
                @case ('expired') {
                  <section class="answer ds-glass" role="alert" data-testid="expired">
                    <p class="m-0 text-headline">Este link expirou ou foi substituído.</p>
                    <p class="m-0 text-footnote text-fg-muted">A agência pode ter mudado o post. Peça um link novo a ela.</p>
                  </section>
                }
                @default {
                  <form class="decide ds-glass" (submit)="$event.preventDefault()" aria-label="Sua resposta" data-testid="decide">
                    <p class="m-0 text-headline">O que achou?</p>
                    @if (mode() === 'changes') {
                      <label class="field">
                        <span class="label">O que precisa ajustar?</span>
                        <textarea name="comment" rows="4" [value]="comment()" (input)="comment.set($any($event.target).value); errors.set({})"></textarea>
                      </label>
                      @if (errors()['comment']) {
                        <p class="error" role="alert">{{ errors()['comment'] }}</p>
                      }
                    }
                    <label class="field">
                      <span class="label">Seu nome (opcional)</span>
                      <input type="text" name="name" autocomplete="name" maxlength="120" [value]="name()" (input)="name.set($any($event.target).value)" />
                    </label>
                    @if (errors()['decision']) {
                      <p class="error" role="alert">{{ errors()['decision'] }}</p>
                    }
                    <div class="buttons">
                      @if (mode() === 'changes') {
                        <button ds-button type="button" variant="ghost" (click)="mode.set('idle'); errors.set({})">Voltar</button>
                        <button ds-button type="button" [loading]="sending()" (click)="send('changes_requested')">Enviar pedido de ajuste</button>
                      } @else {
                        <button ds-button type="button" variant="secondary" (click)="mode.set('changes')">
                          <svg lucideMessageSquare [size]="16"></svg> Pedir ajuste
                        </button>
                        <button ds-button type="button" [loading]="sending()" (click)="send('approved')">Aprovar</button>
                      }
                    </div>
                    <p class="m-0 text-caption text-fg-muted">Link válido até {{ dateTime(d.approval.expires_at) }}.</p>
                  </form>
                }
              }
            }
          }
        }
      }

      @if (!brand()?.hide_delta_badge) {
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
      gap: var(--ds-space-4);
      max-width: 560px;
      margin: 0 auto;
      padding: var(--ds-space-6) var(--ds-space-4) var(--ds-space-6);
    }
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    .brand {
      display: flex;
      align-items: center;
      min-height: 36px;
    }
    .logo {
      max-width: 160px;
      max-height: 40px;
      object-fit: contain;
    }
    .agency {
      color: var(--ds-accent);
    }
    .intro {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
    }
    .where {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .where li {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-fill);
      font: var(--ds-text-footnote);
    }
    .media {
      display: flex;
      gap: var(--ds-space-3);
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      -webkit-overflow-scrolling: touch;
    }
    .slide {
      flex: 0 0 88%;
      margin: 0;
      scroll-snap-align: center;
    }
    .media.single .slide {
      flex-basis: 100%;
    }
    .slide img,
    .slide video {
      display: block;
      width: 100%;
      max-height: 70vh;
      border-radius: var(--ds-radius-lg);
      background: var(--ds-fill);
      object-fit: contain;
    }
    .caption,
    .answer,
    .decide,
    .state {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      padding: var(--ds-space-5) var(--ds-space-4);
      border-radius: var(--ds-radius-xl);
    }
    .caption p {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .answer {
      align-items: center;
      text-align: center;
      color: var(--ds-text);
    }
    .answer svg {
      color: var(--ds-status-healthy);
    }
    .state {
      align-items: center;
      margin-top: 10vh;
      text-align: center;
    }
    .comment {
      margin: 0;
      padding: var(--ds-space-2) var(--ds-space-3);
      border-left: 3px solid var(--ds-accent);
      white-space: pre-wrap;
      text-align: left;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .label {
      font: var(--ds-text-footnote);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .field input,
    .field textarea {
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-body);
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--ds-space-2);
    }
    .buttons button {
      min-height: 44px;
    }
    .error {
      margin: 0;
      font: var(--ds-text-footnote);
      color: var(--ds-status-critical);
    }
    .made {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: var(--ds-space-4);
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
  `,
})
export class ApprovalPage implements OnInit {
  readonly token = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly formatLabel = formatText;
  protected readonly dateTime = formatDateTime;
  protected readonly longDate = formatLongDateTime;

  readonly state = signal<State>({ kind: 'loading' });
  readonly mode = signal<'idle' | 'changes'>('idle');
  readonly comment = signal('');
  readonly name = signal('');
  readonly sending = signal(false);
  readonly errors = signal<Record<string, string>>({});
  /** Resposta enviada nesta visita. */
  readonly done = signal<'approved' | 'changes_requested' | null>(null);

  protected readonly data = computed(() => {
    const s = this.state();
    return s.kind === 'ready' ? s.data : null;
  });
  protected readonly brand = computed(() => this.data()?.brand ?? null);

  ngOnInit(): void {
    // Tema claro para quem recebe o link, sem mexer na preferência salva de quem usa o Delta.
    const root = this.document.documentElement;
    const previous = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    this.destroyRef.onDestroy(() => {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    });
    void this.load();
  }

  async load(): Promise<void> {
    this.state.set({ kind: 'loading' });
    try {
      const res = await firstValueFrom(this.http.get<ApiEnvelope<PublicApproval>>(API.publicApproval(this.token())));
      this.state.set({ kind: 'ready', data: res.data });
    } catch (error) {
      this.state.set({ kind: error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error' });
    }
  }

  async send(decision: ApprovalDecisionBody['decision']): Promise<void> {
    if (this.sending()) return;
    if (decision === 'changes_requested' && !this.comment().trim()) {
      this.errors.set({ comment: 'Conte o que precisa ser ajustado.' });
      return;
    }
    const body: ApprovalDecisionBody = { decision };
    if (decision === 'changes_requested') body.comment = this.comment().trim();
    if (this.name().trim()) body.name = this.name().trim();

    this.sending.set(true);
    try {
      await firstValueFrom(this.http.post(API.publicApproval(this.token()), body));
      this.done.set(decision);
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields && Object.keys(fields).length > 0) {
        this.errors.set(fields);
      } else if (error instanceof HttpErrorResponse && error.status === 404) {
        this.state.set({ kind: 'missing' });
      } else {
        this.errors.set({ decision: 'Não foi possível enviar agora. Tente de novo em instantes.' });
      }
    } finally {
      this.sending.set(false);
    }
  }
}
