import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DsSkeleton } from 'design-system';
import { ContactChannel, MessagePreview } from '../../core/api/api.types';

/**
 * Prévia do que o contato vai receber: bolha no estilo do WhatsApp e cartão de e-mail.
 * O texto vem pronto do backend (variáveis já trocadas pelos números atuais do relatório).
 */
@Component({
  selector: 'app-message-preview',
  imports: [DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading() && !preview()) {
      <div class="stack" aria-busy="true">
        <ds-skeleton width="90%" height="16px" />
        <ds-skeleton width="70%" height="16px" />
        <ds-skeleton width="80%" height="16px" />
      </div>
    } @else if (error()) {
      <p class="m-0 text-footnote text-fg-muted" role="alert">{{ error() }}</p>
    } @else if (preview(); as p) {
      <div class="stack" [class.is-stale]="loading()">
        @if (channels().includes('whatsapp')) {
          <figure class="wa" aria-label="Prévia no WhatsApp">
            <figcaption>WhatsApp</figcaption>
            <div class="wa-screen">
              <div class="bubble" data-preview="whatsapp">
                <p class="wa-text">{{ p.text }}</p>
                <span class="wa-meta">09:00 ✓✓</span>
              </div>
            </div>
            @if (whatsappMode() === 'cloud') {
              <p class="hint">No número oficial a Meta exige o template aprovado; os destaques vão em uma linha.</p>
            }
          </figure>
        }
        @if (channels().includes('email')) {
          <figure class="mail" aria-label="Prévia do e-mail">
            <figcaption>E-mail</figcaption>
            <div class="mail-card" data-preview="email">
              <p class="mail-subject"><span>Assunto</span> {{ p.subject }}</p>
              <p class="mail-text">{{ p.text }}</p>
              <span class="mail-button">Ver relatório completo</span>
              @if (attachPdf()) {
                <span class="mail-attach">📎 Relatório em PDF anexo</span>
              }
            </div>
          </figure>
        }
      </div>
    } @else {
      <p class="m-0 text-footnote text-fg-muted">Escolha o relatório para ver a prévia com os números atuais.</p>
    }
  `,
  styles: `
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
      transition: opacity var(--ds-duration-fast) var(--ds-ease-out);
    }
    .stack.is-stale {
      opacity: 0.6;
    }
    figure {
      margin: 0;
    }
    figcaption {
      margin-bottom: 6px;
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .wa-screen {
      padding: var(--ds-space-4);
      border-radius: var(--ds-radius-lg);
      background:
        radial-gradient(circle at 20% 20%, rgb(255 255 255 / 0.05) 0 2px, transparent 3px) 0 0 / 28px 28px,
        #0b141a;
    }
    .bubble {
      position: relative;
      max-width: 92%;
      margin-left: auto;
      padding: 8px 10px 18px;
      border-radius: 10px 0 10px 10px;
      background: #005c4b;
      color: #e9edef;
      box-shadow: 0 1px 1px rgb(0 0 0 / 0.2);
    }
    .wa-text {
      margin: 0;
      font-size: 14px;
      line-height: 1.4;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .wa-meta {
      position: absolute;
      right: 8px;
      bottom: 3px;
      font-size: 11px;
      color: #53bdeb;
    }
    .mail-card {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      padding: var(--ds-space-4);
      border-radius: var(--ds-radius-lg);
      border: 1px solid var(--ds-separator);
      background: var(--ds-bg-elevated);
    }
    .mail-subject {
      margin: 0;
      padding-bottom: var(--ds-space-2);
      border-bottom: 1px solid var(--ds-separator);
      font: var(--ds-text-subhead);
      font-weight: 600;
    }
    .mail-subject span {
      margin-right: 6px;
      color: var(--ds-text-tertiary);
      font-weight: 400;
    }
    .mail-text {
      margin: 0;
      font: var(--ds-text-subhead);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .mail-button {
      align-self: flex-start;
      padding: 8px 14px;
      border-radius: var(--ds-radius-md);
      background: var(--ds-accent);
      color: #fff;
      font: var(--ds-text-footnote);
      font-weight: 600;
    }
    .mail-attach,
    .hint {
      margin: 6px 0 0;
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
    }
  `,
})
export class MessagePreviewCard {
  readonly preview = input<MessagePreview | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly channels = input<ContactChannel[]>(['email', 'whatsapp']);
  readonly attachPdf = input(true);
  readonly whatsappMode = input<'sandbox' | 'cloud' | null>(null);
}
