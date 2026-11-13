import { ChangeDetectionStrategy, Component, input } from '@angular/core';

let nextId = 0;

/** Marca provisória do Delta: triângulo com gradiente. */
@Component({
  selector: 'app-delta-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style="stop-color: var(--ds-ring-acquisition)" />
          <stop offset="1" style="stop-color: var(--ds-ring-engagement)" />
        </linearGradient>
      </defs>
      <path d="M16 3 L29 27 Q30 29 28 29 L4 29 Q2 29 3 27 Z" [attr.fill]="'url(#' + gradientId + ')'" />
      <path d="M16 12 L22.5 24 L9.5 24 Z" style="fill: var(--ds-bg)" opacity="0.9" />
    </svg>
    @if (withName()) {
      <span class="name">Delta</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 10px;
    }

    .name {
      font: var(--ds-text-title-3);
      letter-spacing: var(--ds-tracking-tight);
    }
  `,
})
export class DeltaLogo {
  protected readonly gradientId = `delta-logo-g-${nextId++}`;
  readonly size = input(32);
  readonly withName = input(true);
}
