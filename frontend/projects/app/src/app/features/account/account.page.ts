import { HttpClient, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { DsButton, DsGlassCard, DsIcon, DsSkeleton, DsTextField, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, Passkey, TwoFactorQrCode, TwoFactorSecretKey } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { CreationOptionsJSON, WebAuthnBrowser, isCancelled, registrationJSON } from '../../core/auth/webauthn';
import { relativeTime } from '../../core/format/relative-time';
import { FieldErrors, extractFieldErrors, validationMessage } from '../../core/forms/server-errors';
import { copyText } from '../settings/settings';
import { needsPassword, recoveryCodesText, shortDate, suggestedPasskeyName, svgDataUrl } from './account';
import { PasswordConfirmDialog } from './password-confirm-dialog';

interface TwoFactorSetup {
  qr: SafeUrl;
  secret: string;
}

/**
 * Minha conta (todos os papéis): perfil, senha, verificação em duas etapas e passkeys.
 * Rotas do Fortify em /auth; as de segurança pedem a senha confirmada (423) e a tela pede a
 * senha num diálogo e repete a ação. ADR 0002 e ADR 0025.
 */
@Component({
  selector: 'app-account-page',
  imports: [FormsModule, DsButton, DsGlassCard, DsIcon, DsSkeleton, DsTextField, PasswordConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-8">
      <h1 class="m-0 text-large-title font-bold tracking-tight">Minha conta</h1>
      <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">Seus dados de acesso e a segurança da sua conta, em todas as agências.</p>
    </header>

    <div class="col">
      <!-- Perfil -->
      <ds-glass-card padding="lg">
        <h2 class="m-0 text-headline">Perfil</h2>
        <form class="form" (submit)="$event.preventDefault(); saveProfile()" novalidate aria-label="Perfil">
          <ds-text-field label="Nome" name="name" autocomplete="name" [ngModel]="name()" (ngModelChange)="name.set($event)" [error]="profileErrors()['name'] ?? null" />
          <ds-text-field label="E-mail" type="email" name="email" autocomplete="email" [ngModel]="email()" (ngModelChange)="email.set($event)" [error]="profileErrors()['email'] ?? null" />
          <div class="actions">
            <button ds-button type="submit" [loading]="savingProfile()" [disabled]="savingProfile() || !profileDirty()">Salvar perfil</button>
          </div>
        </form>
      </ds-glass-card>

      <!-- Senha -->
      <ds-glass-card padding="lg">
        <h2 class="m-0 text-headline">Senha</h2>
        <form class="form" (submit)="$event.preventDefault(); savePassword()" novalidate aria-label="Trocar senha">
          <ds-text-field label="Senha atual" type="password" name="current_password" autocomplete="current-password" [ngModel]="currentPassword()" (ngModelChange)="currentPassword.set($event)" [error]="passwordErrors()['current_password'] ?? null" />
          <ds-text-field label="Nova senha" type="password" name="new_password" autocomplete="new-password" hint="Pelo menos 8 caracteres." [ngModel]="newPassword()" (ngModelChange)="newPassword.set($event)" [error]="passwordErrors()['password'] ?? null" />
          <ds-text-field label="Repita a nova senha" type="password" name="password_confirmation" autocomplete="new-password" [ngModel]="confirmation()" (ngModelChange)="confirmation.set($event)" [error]="passwordErrors()['password_confirmation'] ?? null" />
          <div class="actions">
            <button ds-button type="submit" [loading]="savingPassword()" [disabled]="savingPassword() || !currentPassword() || !newPassword()">Trocar senha</button>
          </div>
        </form>
      </ds-glass-card>

      <!-- Verificação em duas etapas -->
      <ds-glass-card padding="lg" data-testid="two-factor">
        <div class="head">
          <span class="icon" aria-hidden="true"><svg dsIcon="shield-check" [size]="20"></svg></span>
          <div class="min-w-0 flex-1">
            <h2 class="m-0 text-headline">Verificação em duas etapas</h2>
            <p class="m-0 text-footnote text-fg-muted">Além da senha, um código do app autenticador (Google Authenticator, 1Password…).</p>
          </div>
          <span class="chip" [attr.data-tone]="twoFactorOn() ? 'ok' : 'off'" role="status">{{ twoFactorOn() ? 'Ativa' : 'Desativada' }}</span>
        </div>

        @if (setup(); as s) {
          <div class="setup">
            <p class="m-0 text-subhead">1. Escaneie o QR code no app autenticador.</p>
            <img class="qr" [src]="s.qr" alt="QR code para o app autenticador" width="180" height="180" />
            <p class="m-0 text-footnote text-fg-muted">Sem câmera? Digite a chave: <code class="code" data-testid="secret">{{ s.secret }}</code></p>
            <form class="form" (submit)="$event.preventDefault(); confirmTwoFactor()" novalidate aria-label="Confirmar verificação em duas etapas">
              <ds-text-field label="2. Código de 6 dígitos" name="two_factor_code" inputmode="numeric" autocomplete="one-time-code" [maxlength]="6" [ngModel]="code()" (ngModelChange)="code.set($event)" [error]="codeError()" />
              <div class="actions">
                <button ds-button type="button" variant="ghost" (click)="setup.set(null)">Agora não</button>
                <button ds-button type="submit" [loading]="busy() === '2fa-confirm'" [disabled]="busy() !== null || code().trim().length < 6">Confirmar e ativar</button>
              </div>
            </form>
          </div>
        } @else if (!twoFactorOn()) {
          <div class="actions mt-4">
            <button ds-button (click)="enableTwoFactor()" [loading]="busy() === '2fa-enable'" [disabled]="busy() !== null">Ativar</button>
          </div>
        } @else {
          <div class="actions mt-4">
            <button ds-button variant="secondary" size="sm" (click)="showRecoveryCodes()" [loading]="busy() === 'codes'" [disabled]="busy() !== null">Ver códigos de recuperação</button>
            <button ds-button variant="ghost" size="sm" (click)="regenerateCodes()" [loading]="busy() === 'regen'" [disabled]="busy() !== null">Gerar novos códigos</button>
            @if (confirmingDisable()) {
              <span class="text-footnote">Desativar? A conta fica protegida só pela senha.</span>
              <button ds-button variant="ghost" size="sm" (click)="confirmingDisable.set(false)">Cancelar</button>
              <button ds-button variant="destructive" size="sm" [loading]="busy() === '2fa-disable'" (click)="disableTwoFactor()">Desativar</button>
            } @else {
              <button ds-button variant="ghost" size="sm" (click)="confirmingDisable.set(true)">Desativar</button>
            }
          </div>
        }

        @if (recoveryCodes(); as codes) {
          <div class="codes" data-testid="recovery-codes">
            <p class="m-0 text-footnote">
              Guarde estes códigos num lugar seguro. Cada um entra uma vez, se você perder o acesso ao app autenticador.
            </p>
            <ul class="code-list">
              @for (c of codes; track c) {
                <li><code>{{ c }}</code></li>
              }
            </ul>
            <div class="actions">
              <button ds-button variant="secondary" size="sm" (click)="copy(codesText(codes))"><svg dsIcon="copy" [size]="14"></svg> Copiar</button>
              <button ds-button variant="ghost" size="sm" (click)="recoveryCodes.set(null)">Já guardei</button>
            </div>
          </div>
        }
      </ds-glass-card>

      <!-- Passkeys -->
      <ds-glass-card padding="lg" data-testid="passkeys">
        <div class="head">
          <span class="icon" aria-hidden="true"><svg dsIcon="key-round" [size]="20"></svg></span>
          <div class="min-w-0 flex-1">
            <h2 class="m-0 text-headline">Passkeys</h2>
            <p class="m-0 text-footnote text-fg-muted">
              Entre com a digital, o rosto ou o PIN do aparelho, sem senha. Vale como segunda etapa: não pede o código do app.
            </p>
          </div>
        </div>

        @if (!passkeySupported) {
          <p class="m-0 mt-4 text-footnote" role="note" data-testid="passkey-unsupported">
            Este navegador não suporta passkeys. Use uma versão recente do Chrome, Safari, Edge ou Firefox.
          </p>
        } @else {
          @if (passkeys.isLoading() && !passkeys.hasValue()) {
            <div class="mt-4"><ds-skeleton width="60%" /></div>
          } @else if (passkeys.error()) {
            <p class="m-0 mt-4 text-footnote" role="alert">Não foi possível carregar suas passkeys.</p>
          } @else {
            <ul class="list" aria-label="Suas passkeys">
              @for (p of passkeyList(); track p.id) {
                <li class="row">
                  <div class="min-w-0 flex-1">
                    <strong class="text-subhead">{{ p.name }}</strong>
                    <p class="m-0 text-caption text-fg-muted">
                      {{ p.authenticator ?? 'Passkey' }} · criada em {{ date(p.created_at) }} · último uso {{ ago(p.last_used_at) }}
                    </p>
                  </div>
                  @if (confirmRemove() === p.id) {
                    <button ds-button variant="ghost" size="sm" (click)="confirmRemove.set(null)">Cancelar</button>
                    <button ds-button variant="destructive" size="sm" [loading]="busy() === 'remove:' + p.id" (click)="removePasskey(p)">Remover</button>
                  } @else {
                    <button ds-button variant="ghost" size="sm" (click)="confirmRemove.set(p.id)" [attr.aria-label]="'Remover a passkey ' + p.name">Remover</button>
                  }
                </li>
              } @empty {
                <li class="empty text-footnote text-fg-muted">Nenhuma passkey ainda.</li>
              }
            </ul>
          }

          <form class="form add" (submit)="$event.preventDefault(); addPasskey()" novalidate aria-label="Adicionar passkey">
            <ds-text-field label="Nome da passkey" name="passkey_name" hint="Para reconhecer depois, ex.: MacBook do trabalho." [maxlength]="255" [ngModel]="passkeyName()" (ngModelChange)="passkeyName.set($event)" [error]="passkeyError()" />
            <div class="actions">
              <button ds-button type="submit" [loading]="busy() === 'add-passkey'" [disabled]="busy() !== null || !passkeyName().trim()">
                <svg dsIcon="plus" [size]="14"></svg> Adicionar passkey
              </button>
            </div>
          </form>
        }
      </ds-glass-card>
    </div>

    @if (askingPassword()) {
      <app-password-confirm-dialog (confirmed)="resolvePassword(true)" (dismissed)="resolvePassword(false)" />
    }
  `,
  styles: `
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
      max-width: 720px;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
      margin-top: var(--ds-space-4);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .head {
      display: flex;
      align-items: center;
      gap: var(--ds-space-3);
    }
    .icon {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: color-mix(in oklch, var(--ds-accent) 14%, transparent);
      color: var(--ds-accent);
    }
    .chip {
      padding: 2px 10px;
      border-radius: var(--ds-radius-full);
      font: var(--ds-text-caption);
      font-weight: 600;
      white-space: nowrap;
    }
    .chip[data-tone='ok'] {
      background: color-mix(in oklch, var(--ds-status-healthy) 16%, transparent);
      color: var(--ds-status-healthy);
    }
    .chip[data-tone='off'] {
      background: var(--ds-fill);
      color: var(--ds-text-secondary);
    }
    .setup {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      margin-top: var(--ds-space-4);
    }
    .qr {
      width: 180px;
      height: 180px;
      padding: 8px;
      border-radius: var(--ds-radius-md);
      background: #fff;
    }
    .code {
      padding: 1px 6px;
      border-radius: var(--ds-radius-sm);
      background: var(--ds-fill);
      font-family: ui-monospace, monospace;
      overflow-wrap: anywhere;
    }
    .codes {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      margin-top: var(--ds-space-4);
      padding-top: var(--ds-space-4);
      border-top: 1px solid var(--ds-separator);
    }
    .code-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: var(--ds-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
      font-family: ui-monospace, monospace;
    }
    .list {
      display: flex;
      flex-direction: column;
      margin: var(--ds-space-4) 0 0;
      padding: 0;
      list-style: none;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
      padding: var(--ds-space-3) 0;
      border-bottom: 1px solid var(--ds-separator);
    }
    .empty {
      padding: var(--ds-space-3) 0;
    }
    .add {
      padding-top: var(--ds-space-2);
    }
  `,
})
export class AccountPage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(DsToastService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly webauthn = inject(WebAuthnBrowser);

  protected readonly user = this.auth.user;
  protected readonly twoFactorOn = computed(() => this.user()?.two_factor_enabled ?? false);
  protected readonly passkeySupported = this.webauthn.supported();
  protected readonly date = shortDate;
  protected readonly ago = relativeTime;
  protected readonly codesText = recoveryCodesText;

  /* Perfil */
  readonly name = signal('');
  readonly email = signal('');
  readonly profileErrors = signal<FieldErrors>({});
  readonly savingProfile = signal(false);
  protected readonly profileDirty = computed(() => {
    const u = this.user();
    return !!u && (this.name().trim() !== u.name || this.email().trim() !== u.email);
  });

  /* Senha */
  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmation = signal('');
  readonly passwordErrors = signal<FieldErrors>({});
  readonly savingPassword = signal(false);

  /* 2FA */
  readonly setup = signal<TwoFactorSetup | null>(null);
  readonly code = signal('');
  readonly codeError = signal<string | null>(null);
  readonly recoveryCodes = signal<string[] | null>(null);
  readonly confirmingDisable = signal(false);

  /* Passkeys */
  /** Só "há sessão": mudar o perfil ou o 2FA não refaz a busca das passkeys. */
  private readonly signedIn = computed(() => this.user() !== null);
  readonly passkeys = httpResource<ApiEnvelope<Passkey[]>>(() => (this.passkeySupported && this.signedIn() ? API.mePasskeys : undefined));
  protected readonly passkeyList = computed(() => (this.passkeys.hasValue() ? this.passkeys.value().data : []));
  readonly passkeyName = signal(suggestedPasskeyName(typeof navigator === 'undefined' ? '' : navigator.userAgent));
  readonly passkeyError = signal<string | null>(null);
  readonly confirmRemove = signal<number | string | null>(null);

  /** Ação em andamento (um botão por vez). */
  readonly busy = signal<string | null>(null);

  /* Confirmação de senha (423) */
  readonly askingPassword = signal(false);
  private passwordResolver: ((ok: boolean) => void) | null = null;

  /** Último perfil vindo da sessão: o formulário só acompanha a sessão se não houver edição pendente. */
  private synced: { name: string; email: string } | null = null;

  constructor() {
    effect(() => {
      const u = this.user();
      if (!u) return;
      untracked(() => {
        const editing = this.synced !== null && (this.name() !== this.synced.name || this.email() !== this.synced.email);
        if (!editing) {
          this.name.set(u.name);
          this.email.set(u.email);
        }
        this.synced = { name: u.name, email: u.email };
      });
    });
  }

  /* ---------- Perfil e senha ---------- */

  async saveProfile(): Promise<void> {
    this.profileErrors.set({});
    this.savingProfile.set(true);
    try {
      await firstValueFrom(this.http.put(API.profileInformation, { name: this.name().trim(), email: this.email().trim() }));
      await this.auth.loadSession();
      this.toast.success('Perfil atualizado');
    } catch (error) {
      this.fail(error, 'Não foi possível salvar o perfil', (fields) => this.profileErrors.set(fields));
    } finally {
      this.savingProfile.set(false);
    }
  }

  async savePassword(): Promise<void> {
    this.passwordErrors.set({});
    if (this.newPassword() !== this.confirmation()) {
      this.passwordErrors.set({ password_confirmation: 'As senhas não conferem.' });
      return;
    }
    this.savingPassword.set(true);
    try {
      await firstValueFrom(
        this.http.put(API.password, {
          current_password: this.currentPassword(),
          password: this.newPassword(),
          password_confirmation: this.confirmation(),
        }),
      );
      this.currentPassword.set('');
      this.newPassword.set('');
      this.confirmation.set('');
      this.toast.success('Senha trocada');
    } catch (error) {
      this.fail(error, 'Não foi possível trocar a senha', (fields) => this.passwordErrors.set(fields));
    } finally {
      this.savingPassword.set(false);
    }
  }

  /* ---------- Verificação em duas etapas ---------- */

  async enableTwoFactor(): Promise<void> {
    await this.run('2fa-enable', async () => {
      await firstValueFrom(this.http.post(API.twoFactor, {}));
      const [qr, secret] = await Promise.all([
        firstValueFrom(this.http.get<TwoFactorQrCode>(API.twoFactorQrCode)),
        firstValueFrom(this.http.get<TwoFactorSecretKey>(API.twoFactorSecretKey)),
      ]);
      this.code.set('');
      this.codeError.set(null);
      this.recoveryCodes.set(null);
      this.setup.set({ qr: this.sanitizer.bypassSecurityTrustUrl(svgDataUrl(qr.svg)), secret: secret.secretKey });
    });
  }

  async confirmTwoFactor(): Promise<void> {
    this.codeError.set(null);
    await this.run(
      '2fa-confirm',
      async () => {
        await firstValueFrom(this.http.post(API.twoFactorConfirm, { code: this.code().trim() }));
        this.setup.set(null);
        await this.auth.loadSession();
        this.recoveryCodes.set(await firstValueFrom(this.http.get<string[]>(API.twoFactorRecoveryCodes)));
        this.toast.success('Verificação em duas etapas ativada');
      },
      (fields) => this.codeError.set(fields['code'] ?? 'Código inválido. Confira o app e tente de novo.'),
    );
  }

  async showRecoveryCodes(): Promise<void> {
    await this.run('codes', async () => {
      this.recoveryCodes.set(await firstValueFrom(this.http.get<string[]>(API.twoFactorRecoveryCodes)));
    });
  }

  async regenerateCodes(): Promise<void> {
    await this.run('regen', async () => {
      await firstValueFrom(this.http.post(API.twoFactorRecoveryCodes, {}));
      this.recoveryCodes.set(await firstValueFrom(this.http.get<string[]>(API.twoFactorRecoveryCodes)));
      this.toast.success('Códigos novos gerados', { message: 'Os antigos deixaram de valer.' });
    });
  }

  async disableTwoFactor(): Promise<void> {
    await this.run('2fa-disable', async () => {
      await firstValueFrom(this.http.delete(API.twoFactor));
      this.confirmingDisable.set(false);
      this.recoveryCodes.set(null);
      await this.auth.loadSession();
      this.toast.success('Verificação em duas etapas desativada');
    });
  }

  /* ---------- Passkeys ---------- */

  async addPasskey(): Promise<void> {
    const name = this.passkeyName().trim();
    if (!name) return;
    this.passkeyError.set(null);
    try {
      await this.run(
        'add-passkey',
        async () => {
          const { options } = await firstValueFrom(this.http.get<{ options: CreationOptionsJSON }>(API.passkeyRegistrationOptions));
          const credential = await this.webauthn.create(options);
          await firstValueFrom(this.http.post(API.passkeys, { name, credential: registrationJSON(credential) }));
          this.passkeys.reload();
          this.toast.success('Passkey adicionada', { message: 'Na próxima vez, entre com "Entrar com passkey".' });
        },
        (fields) => this.passkeyError.set(fields['credential'] ?? fields['name'] ?? 'Não foi possível cadastrar a passkey.'),
        true,
      );
    } catch (error) {
      this.passkeyError.set(isCancelled(error) ? 'Cadastro cancelado.' : 'Não foi possível cadastrar a passkey. Tente de novo.');
    }
  }

  async removePasskey(passkey: Passkey): Promise<void> {
    await this.run(`remove:${passkey.id}`, async () => {
      await firstValueFrom(this.http.delete(API.passkey(passkey.id)));
      this.confirmRemove.set(null);
      this.passkeys.reload();
      this.toast.success('Passkey removida');
    });
  }

  /* ---------- Senha confirmada (423) ---------- */

  resolvePassword(ok: boolean): void {
    this.askingPassword.set(false);
    const resolve = this.passwordResolver;
    this.passwordResolver = null;
    resolve?.(ok);
  }

  private askPassword(): Promise<boolean> {
    this.passwordResolver?.(false);
    this.askingPassword.set(true);
    return new Promise<boolean>((resolve) => (this.passwordResolver = resolve));
  }

  /**
   * Roda uma ação de segurança: se o servidor pedir a senha (423), pede no diálogo e repete.
   * Erros de validação vão para `onFields`; `rethrowOther` devolve os demais para quem chamou.
   */
  private async run(
    key: string,
    action: () => Promise<void>,
    onFields?: (fields: FieldErrors) => void,
    rethrowOther = false,
  ): Promise<void> {
    if (this.busy()) return;
    this.busy.set(key);
    try {
      try {
        await action();
      } catch (error) {
        if (!needsPassword(error)) throw error;
        this.busy.set(null);
        if (!(await this.askPassword())) return;
        this.busy.set(key);
        await action();
      }
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields && onFields && Object.keys(fields).length > 0) {
        onFields(fields);
      } else if (rethrowOther) {
        throw error;
      } else {
        this.fail(error, 'Não foi possível concluir');
      }
    } finally {
      this.busy.set(null);
    }
  }

  protected async copy(text: string): Promise<void> {
    if (await copyText(text)) this.toast.success('Copiado');
    else this.toast.info('Não foi possível copiar', { message: 'Selecione o texto e copie manualmente.' });
  }

  private fail(error: unknown, title: string, onFields?: (fields: FieldErrors) => void): void {
    const fields = extractFieldErrors(error);
    if (fields && onFields && Object.keys(fields).length > 0) {
      onFields(fields);
      return;
    }
    this.toast.error(title, { message: validationMessage(error) ?? 'Tente de novo em instantes.' });
  }
}
