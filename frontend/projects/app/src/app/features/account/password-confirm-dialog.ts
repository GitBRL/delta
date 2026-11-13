import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DsButton, DsTextField } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API } from '../../core/api/api.types';
import { extractFieldErrors } from '../../core/forms/server-errors';

/**
 * Confirmação de senha antes de mexer na segurança da conta (2FA e passkeys). O Fortify guarda a
 * confirmação por alguns minutos; depois disso, pede de novo.
 */
@Component({
  selector: 'app-password-confirm-dialog',
  imports: [FormsModule, DsButton, DsTextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'dismissed.emit()' },
  template: `
    <div class="backdrop" (click)="dismissed.emit()" aria-hidden="true"></div>
    <section class="panel ds-glass" role="dialog" aria-modal="true" aria-labelledby="confirm-password-title" animate.enter="ds-enter-fade-up">
      <h2 id="confirm-password-title" class="m-0 text-title-3 font-semibold">Confirme sua senha</h2>
      <p class="m-0 text-footnote text-fg-muted">Por segurança, digite sua senha para continuar. Ela vale por alguns minutos.</p>
      <form class="form" (submit)="$event.preventDefault(); submit()" novalidate>
        <ds-text-field
          label="Senha"
          type="password"
          name="confirm_password"
          autocomplete="current-password"
          [ngModel]="password()"
          (ngModelChange)="password.set($event)"
          [error]="error()"
        />
        <div class="actions">
          <button ds-button type="button" variant="ghost" (click)="dismissed.emit()">Cancelar</button>
          <button ds-button type="submit" [loading]="busy()" [disabled]="busy() || !password()">Confirmar</button>
        </div>
      </form>
    </section>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: var(--ds-z-overlay, 50);
      display: grid;
      place-items: center;
      padding: var(--ds-space-4);
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgb(0 0 0 / 0.35);
      backdrop-filter: blur(4px);
    }
    .panel {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      width: min(420px, 100%);
      padding: var(--ds-space-6);
      border-radius: var(--ds-radius-xl);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--ds-space-2);
    }
  `,
})
export class PasswordConfirmDialog {
  private readonly http = inject(HttpClient);

  readonly confirmed = output<void>();
  readonly dismissed = output<void>();

  readonly password = signal('');
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  async submit(): Promise<void> {
    if (!this.password() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.http.post(API.confirmPassword, { password: this.password() }));
      this.confirmed.emit();
    } catch (error) {
      this.error.set(extractFieldErrors(error)?.['password'] ?? 'Não foi possível confirmar a senha. Tente de novo.');
    } finally {
      this.busy.set(false);
    }
  }
}
