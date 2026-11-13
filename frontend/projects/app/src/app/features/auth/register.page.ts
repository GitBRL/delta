import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DsButton, DsTextField, DsToastService } from 'design-system';
import { AuthService } from '../../core/auth/auth.service';
import { FieldErrors, clientErrorMessage, extractFieldErrors, validationMessage } from '../../core/forms/server-errors';
import { AuthLayout } from './auth-layout';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirmation = group.get('password_confirmation');
  if (!confirmation) return null;
  const mismatch = !!confirmation.value && confirmation.value !== password;
  const current = confirmation.errors ?? {};
  if (mismatch && !current['mismatch']) {
    confirmation.setErrors({ ...current, mismatch: true });
  } else if (!mismatch && current['mismatch']) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { mismatch: _removed, ...rest } = current;
    confirmation.setErrors(Object.keys(rest).length ? rest : null);
  }
  return null;
}

type Field = 'name' | 'email' | 'company_name' | 'password' | 'password_confirmation';

const LABELS: Record<Field, string> = {
  name: 'seu nome',
  email: 'seu e-mail',
  company_name: 'o nome da empresa',
  password: 'uma senha',
  password_confirmation: 'a confirmação da senha',
};

@Component({
  selector: 'app-register-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, DsTextField, DsButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-layout heading="Criar conta" subheading="Em 3 passos seu primeiro relatório chega no WhatsApp do cliente.">
      <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <ds-text-field label="Seu nome" name="name" autocomplete="name" formControlName="name" [error]="errorFor('name')" />
        <ds-text-field
          label="E-mail"
          type="email"
          name="email"
          autocomplete="email"
          formControlName="email"
          [error]="errorFor('email')"
        />
        <ds-text-field
          label="Empresa ou agência"
          name="company_name"
          autocomplete="organization"
          hint="Você poderá convidar o time depois."
          formControlName="company_name"
          [error]="errorFor('company_name')"
        />
        <div class="row">
          <ds-text-field
            label="Senha"
            type="password"
            name="password"
            autocomplete="new-password"
            formControlName="password"
            [error]="errorFor('password')"
          />
          <ds-text-field
            label="Confirmar senha"
            type="password"
            name="password_confirmation"
            autocomplete="new-password"
            formControlName="password_confirmation"
            [error]="errorFor('password_confirmation')"
          />
        </div>

        @if (generalError()) {
          <p class="general-error" role="alert" animate.enter="ds-enter-fade-up">{{ generalError() }}</p>
        }

        <button ds-button type="submit" size="lg" [block]="true" [loading]="submitting()" [disabled]="submitting()">
          Criar conta
        </button>
      </form>
      <p class="switch">Já tem conta? <a routerLink="/login">Entrar</a></p>
    </app-auth-layout>
  `,
  styleUrl: './auth-forms.css',
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(DsToastService);

  protected readonly submitting = signal(false);
  protected readonly serverErrors = signal<FieldErrors>({});
  protected readonly generalError = signal<string | null>(null);

  protected readonly form = new FormGroup(
    {
      name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
      email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
      company_name: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(120)],
      }),
      password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
      password_confirmation: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: passwordsMatch },
  );

  protected errorFor(field: Field): string | null {
    return this.serverErrors()[field] ?? clientErrorMessage(this.form.controls[field], LABELS[field]);
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
      await this.auth.register(this.form.getRawValue());
      this.toast.success('Conta criada', { message: 'Bem-vindo ao Delta!' });
      await this.router.navigateByUrl('/overview');
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields && Object.keys(fields).length) {
        this.serverErrors.set(fields);
      } else {
        this.generalError.set(validationMessage(error) ?? 'Não foi possível criar a conta agora. Tente novamente.');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
