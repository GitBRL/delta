import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DsButton, DsTextField } from 'design-system';
import { AuthService } from '../../core/auth/auth.service';
import { WebAuthnBrowser, assertionJSON, isCancelled } from '../../core/auth/webauthn';
import { FieldErrors, clientErrorMessage, extractFieldErrors, validationMessage } from '../../core/forms/server-errors';
import { AuthLayout } from './auth-layout';

type Step = 'credentials' | 'two-factor';

/**
 * Destino depois do login: só caminhos internos ("/..."), nunca "//host" ou "/\\host"
 * (o navegador trataria como outra origem) — evita open redirect.
 */
export function safeRedirect(target: string | null | undefined): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
    return '/overview';
  }
  return target;
}

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, DsTextField, DsButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (step() === 'credentials') {
      <app-auth-layout heading="Entrar" subheading="Relatórios e inteligência de marketing para sua agência.">
        <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <ds-text-field
            label="E-mail"
            type="email"
            name="email"
            autocomplete="username"
            formControlName="email"
            [error]="errorFor('email', 'seu e-mail')"
          />
          <ds-text-field
            label="Senha"
            type="password"
            name="password"
            autocomplete="current-password"
            formControlName="password"
            [error]="errorFor('password', 'sua senha')"
          />
          <label class="remember">
            <input type="checkbox" formControlName="remember" />
            <span>Manter conectado neste dispositivo</span>
          </label>

          @if (generalError()) {
            <p class="general-error" role="alert" animate.enter="ds-enter-fade-up">{{ generalError() }}</p>
          }

          <button ds-button type="submit" size="lg" [block]="true" [loading]="submitting()" [disabled]="submitting() || passkeyBusy()">
            Entrar
          </button>
        </form>
        @if (passkeySupported) {
          <div class="or" aria-hidden="true"><span>ou</span></div>
          <button
            ds-button
            type="button"
            variant="secondary"
            size="lg"
            [block]="true"
            [loading]="passkeyBusy()"
            [disabled]="submitting() || passkeyBusy()"
            (click)="loginWithPasskey()"
          >
            Entrar com passkey
          </button>
          <p class="passkey-hint">Use a digital, o rosto ou o PIN do seu dispositivo, sem digitar a senha.</p>
        }
        <p class="switch">Ainda não tem conta? <a routerLink="/cadastro">Criar conta</a></p>
      </app-auth-layout>
    } @else {
      <app-auth-layout heading="Verificação em duas etapas" [subheading]="twoFactorSubheading()">
        <form class="form" [formGroup]="twoFactorForm" (ngSubmit)="submitTwoFactor()" novalidate>
          @if (useRecoveryCode()) {
            <ds-text-field
              label="Código de recuperação"
              name="recovery_code"
              autocomplete="off"
              formControlName="recoveryCode"
              [error]="twoFactorError('recovery_code')"
            />
          } @else {
            <ds-text-field
              label="Código do app autenticador"
              name="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              [maxlength]="6"
              formControlName="code"
              [error]="twoFactorError('code')"
            />
          }
          <button ds-button type="submit" size="lg" [block]="true" [loading]="submitting()" [disabled]="submitting()">
            Verificar
          </button>
          <button ds-button type="button" variant="ghost" [block]="true" (click)="toggleRecovery()">
            {{ useRecoveryCode() ? 'Usar código do app' : 'Usar código de recuperação' }}
          </button>
        </form>
      </app-auth-layout>
    }
  `,
  styleUrl: './auth-forms.css',
})
export class LoginPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly webauthn = inject(WebAuthnBrowser);

  /** Passkey só aparece se o navegador suportar WebAuthn. */
  protected readonly passkeySupported = this.webauthn.supported();
  protected readonly passkeyBusy = signal(false);

  /** Destino após o login (query param ?redirect=, via withComponentInputBinding). */
  readonly redirect = input<string>();
  /** E-mail sugerido (?email=), ex.: vindo de um convite. */
  readonly email = input<string>();

  protected readonly step = signal<Step>('credentials');
  protected readonly submitting = signal(false);
  protected readonly serverErrors = signal<FieldErrors>({});
  protected readonly generalError = signal<string | null>(null);
  protected readonly useRecoveryCode = signal(false);
  protected readonly twoFactorSubheading = computed(() =>
    this.useRecoveryCode()
      ? 'Digite um dos seus códigos de recuperação.'
      : 'Digite o código de 6 dígitos do seu app autenticador.',
  );

  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    remember: new FormControl(true, { nonNullable: true }),
  });

  protected readonly twoFactorForm = new FormGroup({
    code: new FormControl('', { nonNullable: true }),
    recoveryCode: new FormControl('', { nonNullable: true }),
  });

  ngOnInit(): void {
    const email = this.email()?.trim();
    if (email) this.form.controls.email.setValue(email);
  }

  protected errorFor(field: 'email' | 'password', label: string): string | null {
    return this.serverErrors()[field] ?? clientErrorMessage(this.form.controls[field], label);
  }

  protected twoFactorError(field: 'code' | 'recovery_code'): string | null {
    return this.serverErrors()[field] ?? null;
  }

  protected toggleRecovery(): void {
    this.useRecoveryCode.update((v) => !v);
    this.serverErrors.set({});
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    this.serverErrors.set({});
    this.generalError.set(null);
    if (this.form.invalid) {
      return;
    }

    this.submitting.set(true);
    try {
      const outcome = await this.auth.login(this.form.getRawValue());
      if (outcome === 'two-factor') {
        this.step.set('two-factor');
      } else {
        await this.goToApp();
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.submitting.set(false);
    }
  }

  protected async submitTwoFactor(): Promise<void> {
    this.serverErrors.set({});
    const { code, recoveryCode } = this.twoFactorForm.getRawValue();
    const body = this.useRecoveryCode() ? { recovery_code: recoveryCode.trim() } : { code: code.trim() };

    this.submitting.set(true);
    try {
      await this.auth.twoFactorChallenge(body);
      await this.goToApp();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.submitting.set(false);
    }
  }

  /** Login com passkey (ADR 0025): desafio do servidor → navegador → assinatura de volta. */
  protected async loginWithPasskey(): Promise<void> {
    this.serverErrors.set({});
    this.generalError.set(null);
    this.passkeyBusy.set(true);
    try {
      const options = await this.auth.passkeyLoginOptions();
      const credential = await this.webauthn.get(options);
      await this.auth.passkeyLogin(assertionJSON(credential), this.form.controls.remember.value);
      await this.goToApp();
    } catch (error) {
      if (isCancelled(error)) {
        this.generalError.set('Login com passkey cancelado.');
      } else {
        const fields = extractFieldErrors(error);
        this.generalError.set(
          fields?.['credential'] ?? validationMessage(error) ?? 'Não foi possível entrar com a passkey. Tente de novo ou use a senha.',
        );
      }
    } finally {
      this.passkeyBusy.set(false);
    }
  }

  private handleError(error: unknown): void {
    const fields = extractFieldErrors(error);
    if (fields) {
      this.serverErrors.set(fields);
      if (Object.keys(fields).length === 0) {
        this.generalError.set(validationMessage(error) ?? 'Não foi possível entrar.');
      }
    } else {
      this.generalError.set('Não foi possível entrar agora. Tente novamente.');
    }
  }

  private async goToApp(): Promise<void> {
    await this.router.navigateByUrl(safeRedirect(this.redirect()));
  }
}
