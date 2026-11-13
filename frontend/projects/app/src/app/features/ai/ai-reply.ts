import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideTriangleAlert } from '@lucide/angular';
import { AiReply } from '../../core/api/api.types';

/**
 * Texto do copiloto com o aviso dos números que não batem com os dados (ADR 0021).
 * Toda resposta é sugestão: o rodapé lembra de revisar antes de usar.
 */
@Component({
  selector: 'app-ai-reply',
  imports: [LucideTriangleAlert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!reply().verified) {
      <div class="unverified" role="alert">
        <svg lucideTriangleAlert [size]="18" aria-hidden="true"></svg>
        <div>
          <p class="m-0 font-semibold">Confira antes de enviar</p>
          @if (reply().unverified_numbers.length) {
            <p class="m-0">Estes números não batem com os dados; confira antes de enviar:</p>
            <ul class="nums">
              @for (n of reply().unverified_numbers; track $index) {
                <li><code>{{ n }}</code></li>
              }
            </ul>
          } @else {
            <p class="m-0">Alguns números do texto não puderam ser conferidos com os dados.</p>
          }
        </div>
      </div>
    }
    <div class="text" data-testid="ai-text">{{ reply().text }}</div>
    <p class="foot">Sugestão do copiloto de IA ({{ reply().model }}). Revise antes de usar.</p>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .text {
      font: var(--ds-text-body);
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .unverified {
      display: flex;
      gap: var(--ds-space-2);
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: color-mix(in oklch, var(--ds-status-attention) 16%, transparent);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
    }
    .unverified svg {
      flex: none;
      color: var(--ds-status-attention);
    }
    .nums {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 6px 0 0;
      padding: 0;
      list-style: none;
    }
    .nums code {
      padding: 1px 8px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-fill);
      font-family: ui-monospace, monospace;
    }
    .foot {
      margin: 0;
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
  `,
})
export class AiReplyView {
  readonly reply = input.required<AiReply>();
}
