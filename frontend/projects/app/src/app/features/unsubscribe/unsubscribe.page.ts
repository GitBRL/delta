import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DsButton, DsSkeleton } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, UnsubscribePreview } from '../../core/api/api.types';
import { AuthLayout } from '../auth/auth-layout';

export type UnsubscribeView = 'loading' | 'confirm' | 'done' | 'already' | 'invalid' | 'notfound' | 'error';

const CHANNEL_TEXT = { email: 'por e-mail', whatsapp: 'pelo WhatsApp' } as const;

const HEADINGS: Readonly<Record<UnsubscribeView, string>> = {
  loading: 'Parar de receber relatórios',
  confirm: 'Parar de receber relatórios',
  done: 'Descadastro feito',
  already: 'Descadastro',
  invalid: 'Link inválido',
  notfound: 'Contato não encontrado',
  error: 'Parar de receber relatórios',
};

/**
 * /descadastrar (pública, sem login): o link do e-mail traz tenant, contato, canal e a assinatura
 * do Delta. A query é repassada intacta para a API (a assinatura depende da ordem exata).
 */
@Component({
  selector: 'app-unsubscribe-page',
  imports: [AuthLayout, DsButton, DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-layout [heading]="heading()">
      @switch (view()) {
        @case ('loading') {
          <div class="stack" aria-busy="true"><ds-skeleton width="80%" /><ds-skeleton width="60%" /></div>
        }
        @case ('confirm') {
          @if (info(); as i) {
            <p class="lead">
              Olá, {{ i.name }}. Quer deixar de receber os relatórios{{ i.agency ? ' da ' + i.agency : '' }} {{ channelText() }}?
            </p>
            <p class="muted">Você pode voltar a receber quando quiser, pedindo à agência.</p>
            <button ds-button class="w-full" [loading]="busy()" (click)="confirm()">Não quero mais receber</button>
          }
        }
        @case ('done') {
          <p class="lead" role="status">Pronto, {{ info()?.name }}. Você não vai mais receber os relatórios {{ channelText() }}.</p>
          <p class="muted">A agência foi avisada pelo registro de consentimento. Pode fechar esta página.</p>
        }
        @case ('already') {
          <p class="lead">Você já não recebe os relatórios {{ channelText() }}.</p>
          <p class="muted">Nada mais a fazer. Pode fechar esta página.</p>
        }
        @case ('invalid') {
          <p class="lead" role="alert">Este link não é válido.</p>
          <p class="muted">Use o link "Não quero mais receber" do e-mail mais recente, sem alterar o endereço.</p>
        }
        @case ('notfound') {
          <p class="lead" role="alert">Não encontramos este contato.</p>
          <p class="muted">Ele pode ter sido removido pela agência, e nesse caso você já não recebe nada.</p>
        }
        @default {
          <p class="lead" role="alert">Não foi possível concluir agora.</p>
          <button ds-button variant="secondary" (click)="load()">Tentar de novo</button>
        }
      }
    </app-auth-layout>
  `,
  styles: `
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .lead {
      margin: 0 0 var(--ds-space-3);
      font: var(--ds-text-body);
    }
    .muted {
      margin: 0 0 var(--ds-space-5);
      font: var(--ds-text-footnote);
      color: var(--ds-text-secondary);
    }
    .w-full {
      width: 100%;
    }
  `,
})
export class UnsubscribePage {
  private readonly http = inject(HttpClient);
  private readonly query = inject(DOCUMENT).location.search;

  readonly view = signal<UnsubscribeView>('loading');
  readonly info = signal<UnsubscribePreview | null>(null);
  readonly busy = signal(false);

  protected readonly channelText = computed(() => CHANNEL_TEXT[this.info()?.channel ?? 'email']);
  protected readonly heading = computed(() => HEADINGS[this.view()]);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    if (!this.query || this.query === '?') {
      this.view.set('invalid');
      return;
    }
    this.view.set('loading');
    try {
      const res = await firstValueFrom(this.http.get<ApiEnvelope<UnsubscribePreview>>(API.publicUnsubscribe + this.query));
      this.info.set(res.data);
      this.view.set(res.data.subscribed ? 'confirm' : 'already');
    } catch (error) {
      this.view.set(this.errorView(error));
    }
  }

  async confirm(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      // Quem abre o link pelo e-mail ainda não tem o cookie XSRF da SPA.
      await firstValueFrom(this.http.get(API.csrf));
      await firstValueFrom(this.http.post(API.publicUnsubscribe + this.query, {}));
      this.view.set('done');
    } catch (error) {
      this.view.set(this.errorView(error));
    } finally {
      this.busy.set(false);
    }
  }

  private errorView(error: unknown): UnsubscribeView {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 403) return 'invalid';
      if (error.status === 404) return 'notfound';
    }
    return 'error';
  }
}
