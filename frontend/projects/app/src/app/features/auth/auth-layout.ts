import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DsGlassCard, DsThemeToggle } from 'design-system';
import { AmbientBackground } from './ambient-background';
import { DeltaLogo } from './delta-logo';

/** Moldura das telas de autenticação: fundo ambiente + cartão de vidro central. */
@Component({
  selector: 'app-auth-layout',
  imports: [AmbientBackground, DeltaLogo, DsGlassCard, DsThemeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-ambient-background />
    <div class="corner"><ds-theme-toggle /></div>
    <main class="center">
      <app-delta-logo class="logo ds-enter-fade-up" [size]="36" />
      <ds-glass-card class="card ds-enter-scale" [interactive]="true" [tilt]="false" padding="lg">
        <h1 class="title">{{ heading() }}</h1>
        @if (subheading()) {
          <p class="subtitle">{{ subheading() }}</p>
        }
        <ng-content />
      </ds-glass-card>
      <ng-content select="[authFooter]" />
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
    }

    .corner {
      position: fixed;
      top: var(--ds-space-4);
      right: var(--ds-space-4);
      z-index: 2;
    }

    .center {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--ds-space-6);
      min-height: 100dvh;
      padding: var(--ds-space-8) var(--ds-space-4);
    }

    .card {
      width: min(420px, 100%);
    }

    .title {
      margin: 0;
      font: var(--ds-text-title-1);
      letter-spacing: var(--ds-tracking-tight);
    }

    .subtitle {
      margin: var(--ds-space-2) 0 var(--ds-space-6);
      color: var(--ds-text-secondary);
      font: var(--ds-text-subhead);
    }
  `,
})
export class AuthLayout {
  readonly heading = input.required<string>();
  readonly subheading = input<string>();
}
