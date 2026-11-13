import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  API,
  AcceptInvitationBody,
  AcceptedInvitation,
  ApiEnvelope,
  LoginBody,
  LoginResponse,
  Me,
  RegisterBody,
  TwoFactorBody,
} from '../api/api.types';
import { AssertionCredentialJSON, RequestOptionsJSON } from './webauthn';

export type SessionStatus = 'unknown' | 'authenticated' | 'guest';
export type LoginOutcome = 'authenticated' | 'two-factor';

/**
 * Sessão do usuário (Sanctum SPA: cookie de sessão + XSRF).
 * Estado em signals; as chamadas usam async/await para os componentes tratarem erros com try/catch.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  private readonly userSignal = signal<Me | null>(null);
  private readonly statusSignal = signal<SessionStatus>('unknown');
  private pendingSession: Promise<boolean> | null = null;

  readonly user = this.userSignal.asReadonly();
  readonly status = this.statusSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.statusSignal() === 'authenticated');

  /** Garante que o estado da sessão foi consultado uma vez (usado pelos guards). */
  ensureSession(): Promise<boolean> {
    if (this.statusSignal() !== 'unknown') {
      return Promise.resolve(this.isAuthenticated());
    }
    return this.loadSession();
  }

  /** Consulta /api/me. Evita chamadas duplicadas simultâneas. */
  loadSession(): Promise<boolean> {
    this.pendingSession ??= (async () => {
      try {
        const res = await firstValueFrom(this.http.get<ApiEnvelope<Me>>(API.me));
        this.userSignal.set(res.data);
        this.statusSignal.set('authenticated');
        return true;
      } catch (error) {
        this.clear();
        if (error instanceof HttpErrorResponse && error.status !== 401) {
          console.warn('[auth] não foi possível consultar a sessão', error.status);
        }
        return false;
      } finally {
        this.pendingSession = null;
      }
    })();
    return this.pendingSession;
  }

  async login(body: LoginBody): Promise<LoginOutcome> {
    await this.csrf();
    const res = await firstValueFrom(this.http.post<LoginResponse>(API.login, body));
    if (res?.two_factor) {
      return 'two-factor';
    }
    await this.loadSession();
    return 'authenticated';
  }

  async twoFactorChallenge(body: TwoFactorBody): Promise<void> {
    await this.csrf();
    await firstValueFrom(this.http.post(API.twoFactorChallenge, body));
    await this.loadSession();
  }

  /** Desafio do login com passkey (fica na sessão do servidor até a resposta). ADR 0025. */
  async passkeyLoginOptions(): Promise<RequestOptionsJSON> {
    await this.csrf();
    const res = await firstValueFrom(this.http.get<{ options: RequestOptionsJSON }>(API.passkeyLoginOptions));
    return res.options;
  }

  /** Entra com a assinatura da passkey: não pede o código do 2FA (a passkey já é o segundo fator). */
  async passkeyLogin(credential: AssertionCredentialJSON, remember: boolean): Promise<void> {
    await firstValueFrom(this.http.post(API.passkeyLogin, { credential, remember }));
    await this.loadSession();
  }

  async register(body: RegisterBody): Promise<void> {
    await this.csrf();
    await firstValueFrom(this.http.post(API.register, body));
    await this.loadSession();
  }

  /**
   * Aceita um convite. Com sessão, o corpo vai vazio; sem sessão, cria a conta com o e-mail do
   * convite (o backend já entra com ela). Em ambos os casos recarrega /api/me, que passa a
   * listar a agência nova.
   */
  async acceptInvitation(token: string, body: AcceptInvitationBody | null = null): Promise<AcceptedInvitation> {
    await this.csrf();
    const res = await firstValueFrom(
      this.http.post<ApiEnvelope<AcceptedInvitation>>(API.invitationAccept(token), body ?? {}),
    );
    await this.loadSession();
    return res.data;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(API.logout, {}));
    } finally {
      this.clear();
    }
  }

  /** Limpa o estado local (ex.: após 401). */
  clear(): void {
    this.userSignal.set(null);
    this.statusSignal.set('guest');
  }

  /** Obtém o cookie XSRF-TOKEN antes de requisições que alteram estado sem sessão prévia. */
  private async csrf(): Promise<void> {
    await firstValueFrom(this.http.get(API.csrf));
  }
}
