import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DsButton, DsSkeleton, DsTextField, DsToastService } from 'design-system';
import { API, AcceptedInvitation, ApiEnvelope, InvitationPreview } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { FieldErrors, clientErrorMessage, extractFieldErrors, validationMessage } from '../../core/forms/server-errors';
import { TenantService } from '../../core/tenant/tenant.service';
import { AuthLayout } from '../auth/auth-layout';
import { ROLE_DESCRIPTION, ROLE_LABEL } from '../team/team';

/** O que a tela mostra, a partir do convite e da sessão. */
export type InvitationView =
  | 'loading'
  | 'invalid'
  | 'error'
  | 'accepted'
  | 'revoked'
  | 'expired'
  | 'accept'
  | 'mismatch'
  | 'login'
  | 'register';

const HEADINGS: Readonly<Record<InvitationView, string>> = {
  loading: 'Convite',
  invalid: 'Convite não encontrado',
  error: 'Convite',
  accepted: 'Convite já aceito',
  revoked: 'Convite cancelado',
  expired: 'Convite expirado',
  accept: 'Você foi convidado',
  mismatch: 'Você foi convidado',
  login: 'Você foi convidado',
  register: 'Você foi convidado',
};

type Field = 'name' | 'password' | 'password_confirmation';

const LABELS: Record<Field, string> = {
  name: 'seu nome',
  password: 'uma senha',
  password_confirmation: 'a confirmação da senha',
};

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * /convite/:token (pública). Mostra quem convidou, para qual agência e papel, e o caminho certo:
 * aceitar (logado com o e-mail do convite), trocar de conta, entrar, ou criar a conta.
 */
@Component({
  selector: 'app-invitation-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, DsButton, DsSkeleton, DsTextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invitation.page.html',
  styleUrls: ['../auth/auth-forms.css', './invitation.page.css'],
})
export class InvitationPage {
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantService);
  private readonly router = inject(Router);
  private readonly toast = inject(DsToastService);

  /** Parâmetro de rota (withComponentInputBinding). */
  readonly token = input('');

  protected readonly roleLabel = ROLE_LABEL;
  protected readonly roleDescription = ROLE_DESCRIPTION;

  protected readonly preview = httpResource<ApiEnvelope<InvitationPreview>>(() =>
    this.token() ? API.invitation(this.token()) : undefined,
  );
  protected readonly invitation = computed(() => (this.preview.hasValue() ? this.preview.value().data : null));

  private readonly sessionChecked = signal(false);
  /** 409 no cadastro: a conta já existe, então o caminho vira "entrar". */
  private readonly accountFound = signal(false);

  protected readonly submitting = signal(false);
  protected readonly serverErrors = signal<FieldErrors>({});
  protected readonly generalError = signal<string | null>(null);

  readonly view = computed<InvitationView>(() => {
    if (!this.sessionChecked() || (this.preview.isLoading() && !this.preview.hasValue())) return 'loading';

    const error = this.preview.error();
    if (error) {
      const status = (error as Partial<HttpErrorResponse>).status;
      return status === 404 || status === 400 ? 'invalid' : 'error';
    }

    const invitation = this.invitation();
    if (!invitation) return 'invalid';
    if (invitation.status !== 'pending') return invitation.status;

    const user = this.auth.user();
    if (this.auth.isAuthenticated() && user) return sameEmail(user.email, invitation.email) ? 'accept' : 'mismatch';
    return invitation.account_exists || this.accountFound() ? 'login' : 'register';
  });

  protected readonly heading = computed(() => HEADINGS[this.view()]);

  protected readonly subheading = computed(() => {
    const invitation = this.invitation();
    const view = this.view();
    if (!invitation) {
      return view === 'invalid' ? 'O link pode estar incompleto. Confira com quem convidou você.' : undefined;
    }
    switch (view) {
      case 'accepted':
        return `Este convite para a ${invitation.tenant_name} já foi usado. Entre com ${invitation.email} para acessar.`;
      case 'revoked':
        return `A ${invitation.tenant_name} cancelou este convite. Peça um novo a quem convidou você.`;
      case 'expired':
        return `Os convites valem 7 dias. Peça um novo a ${invitation.inviter_name ?? 'quem convidou você'}.`;
      case 'accept':
      case 'mismatch':
      case 'login':
      case 'register':
        return `${invitation.inviter_name ?? 'A equipe'} convidou você para a ${invitation.tenant_name} como ${ROLE_LABEL[invitation.role].toLowerCase()}.`;
      default:
        return undefined;
    }
  });

  /** Para o "Entrar para aceitar": volta para este convite com o e-mail já preenchido. */
  protected readonly loginQuery = computed(() => ({
    redirect: `/convite/${this.token()}`,
    email: this.invitation()?.email ?? null,
  }));

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
    password_confirmation: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    void this.auth.ensureSession().finally(() => this.sessionChecked.set(true));
  }

  protected errorFor(field: Field): string | null {
    if (this.serverErrors()[field]) return this.serverErrors()[field] ?? null;
    if (field === 'password_confirmation') {
      const { password, password_confirmation } = this.form.getRawValue();
      const control = this.form.controls.password_confirmation;
      if ((control.touched || control.dirty) && password_confirmation && password !== password_confirmation) {
        return 'As senhas não conferem.';
      }
    }
    return clientErrorMessage(this.form.controls[field], LABELS[field]);
  }

  /** Logado com o e-mail do convite. */
  async accept(): Promise<void> {
    if (this.submitting()) return;
    this.generalError.set(null);
    this.submitting.set(true);
    try {
      await this.finish(await this.auth.acceptInvitation(this.token()));
    } catch (error) {
      this.handleError(error);
    } finally {
      this.submitting.set(false);
    }
  }

  /** Sem conta: cria com o e-mail do convite e já aceita. */
  async register(): Promise<void> {
    this.form.markAllAsTouched();
    this.serverErrors.set({});
    this.generalError.set(null);
    const value = this.form.getRawValue();
    if (this.form.invalid || value.password !== value.password_confirmation || this.submitting()) return;

    this.submitting.set(true);
    try {
      await this.finish(await this.auth.acceptInvitation(this.token(), { ...value, name: value.name.trim() }));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.accountFound.set(true);
        this.generalError.set(this.messageOf(error) ?? 'Já existe uma conta com este e-mail. Entre para aceitar o convite.');
        return;
      }
      this.handleError(error);
    } finally {
      this.submitting.set(false);
    }
  }

  /** Logado com outra conta: sai e volta para o login com o e-mail do convite. */
  async switchAccount(): Promise<void> {
    try {
      await this.auth.logout();
    } finally {
      await this.router.navigate(['/login'], { queryParams: this.loginQuery() });
    }
  }

  private async finish(accepted: AcceptedInvitation): Promise<void> {
    this.tenant.select(accepted.tenant_id);
    this.toast.success(`Bem-vindo à ${accepted.tenant_name}`, { message: 'Você já faz parte da equipe.' });
    await this.router.navigateByUrl('/overview');
  }

  private handleError(error: unknown): void {
    const fields = extractFieldErrors(error);
    if (fields && Object.keys(fields).length > 0) {
      this.serverErrors.set(fields);
      return;
    }
    if (error instanceof HttpErrorResponse && (error.status === 403 || error.status === 410)) {
      this.generalError.set(this.messageOf(error) ?? 'Este convite não pode mais ser usado.');
      if (error.status === 410) this.preview.reload();
      return;
    }
    this.generalError.set(validationMessage(error) ?? 'Não foi possível aceitar o convite agora. Tente novamente.');
  }

  private messageOf(error: HttpErrorResponse): string | null {
    const body = error.error as { message?: unknown } | null;
    return typeof body?.message === 'string' && body.message ? body.message : null;
  }
}
