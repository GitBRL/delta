import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DsButton, DsGlassCard, DsSkeleton, DsTextField, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, WhatsAppMode, WhatsAppResponse, WhatsAppSettings, WhatsAppVerification } from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors } from '../../core/forms/server-errors';
import { relativeTime } from '../../core/format/relative-time';
import { TenantService } from '../../core/tenant/tenant.service';
import { WHATSAPP_STATUS, WhatsAppDraft, validateWhatsApp, whatsappBody, whatsappDraftFrom } from './whatsapp';

/**
 * Integrações › WhatsApp (dono/admin): demonstração (padrão) ou o número oficial pela Cloud API
 * da Meta. Token e app secret entram e não voltam ao navegador.
 */
@Component({
  selector: 'app-whatsapp-page',
  imports: [FormsModule, RouterLink, DsButton, DsGlassCard, DsSkeleton, DsTextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-8">
      <a class="back" routerLink="/integracoes">‹ Integrações</a>
      <h1 class="m-0 mt-1 text-large-title font-bold tracking-tight">WhatsApp da agência</h1>
      <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
        Os envios automáticos usam o número da agência pela API oficial da Meta. Enquanto ele não estiver
        configurado, o Delta trabalha em demonstração: nada sai daqui e "entregue" e "lido" são simulados.
      </p>
    </header>

    @if (!tenant.isAdmin()) {
      <ds-glass-card padding="lg" class="block" role="note">
        <p class="m-0 text-headline">Só donos e administradores da agência configuram o WhatsApp.</p>
        <p class="m-0 mt-1 text-subhead text-fg-muted">Peça a um deles para ligar o número oficial.</p>
      </ds-glass-card>
    } @else if (settings.isLoading() && !settings.hasValue()) {
      <ds-glass-card padding="lg" class="block"><ds-skeleton width="50%" /><ds-skeleton width="70%" /></ds-glass-card>
    } @else if (settings.error() && !settings.hasValue()) {
      <ds-glass-card padding="lg" class="block" role="alert">
        <p class="m-0 text-headline">Não foi possível carregar a configuração.</p>
        <button ds-button variant="secondary" size="sm" class="mt-3" (click)="settings.reload()">Tentar de novo</button>
      </ds-glass-card>
    } @else if (current(); as s) {
      <div class="layout">
        <ds-glass-card padding="lg" class="block">
          <div class="status-row">
            <span class="status" [attr.data-tone]="statusMeta[s.status].tone" data-testid="wa-status">{{ statusMeta[s.status].label }}</span>
            @if (s.display_phone) {
              <span class="text-subhead">{{ s.display_phone }}</span>
            }
            @if (s.updated_at) {
              <small class="text-fg-muted">atualizado {{ relativeTime(s.updated_at) }}{{ s.updated_by ? ' por ' + s.updated_by : '' }}</small>
            }
          </div>
          @if (result(); as r) {
            <p class="result" [class.ok]="r.ok" [attr.role]="r.ok ? 'status' : 'alert'">{{ r.message }}</p>
          } @else if (s.verification_error) {
            <p class="result" role="alert">{{ s.verification_error }}</p>
          }

          <div class="modes" role="radiogroup" aria-label="Modo">
            <label class="mode" [class.on]="draft().mode === 'sandbox'">
              <input type="radio" name="mode" value="sandbox" [checked]="draft().mode === 'sandbox'" (change)="setMode('sandbox')" />
              <span><strong>Demonstração</strong><small>Para testar a jornada sem enviar nada de verdade.</small></span>
            </label>
            <label class="mode" [class.on]="draft().mode === 'cloud'">
              <input type="radio" name="mode" value="cloud" [checked]="draft().mode === 'cloud'" (change)="setMode('cloud')" />
              <span><strong>Número oficial</strong><small>Cloud API da Meta, com template aprovado.</small></span>
            </label>
          </div>

          @if (draft().mode === 'cloud') {
            <form class="form" (submit)="$event.preventDefault(); save()" novalidate>
              <div class="grid-2">
                <ds-text-field label="ID do número de telefone" name="phone_number_id" autocomplete="off" inputmode="numeric" hint="WhatsApp › Configuração da API" [ngModel]="draft().phone_number_id" (ngModelChange)="patch({ phone_number_id: $event })" [error]="errors()['phone_number_id'] ?? null" />
                <ds-text-field label="ID da conta WhatsApp Business (opcional)" name="waba_id" autocomplete="off" inputmode="numeric" [ngModel]="draft().waba_id" (ngModelChange)="patch({ waba_id: $event })" [error]="errors()['waba_id'] ?? null" />
              </div>
              <ds-text-field
                label="Token de acesso permanente"
                type="password"
                name="access_token"
                autocomplete="off"
                [placeholder]="s.has_access_token ? 'Salvo · deixe em branco para manter' : 'Token do usuário do sistema'"
                hint="Gerado em Configurações do negócio › Usuários do sistema. Nunca é exibido de novo."
                [ngModel]="draft().access_token"
                (ngModelChange)="patch({ access_token: $event })"
                [error]="errors()['access_token'] ?? null"
              />
              <ds-text-field
                label="Chave secreta do app"
                type="password"
                name="app_secret"
                autocomplete="off"
                [placeholder]="s.has_app_secret ? 'Salva · deixe em branco para manter' : '32 caracteres (0–9, a–f)'"
                hint="Confere a assinatura do webhook. Configurações › Básico, no painel do app."
                [ngModel]="draft().app_secret"
                (ngModelChange)="patch({ app_secret: $event })"
                [error]="errors()['app_secret'] ?? null"
              />
              <div class="grid-2">
                <ds-text-field label="Nome do template aprovado" name="template_name" autocomplete="off" [ngModel]="draft().template_name" (ngModelChange)="patch({ template_name: $event })" [error]="errors()['template_name'] ?? null" />
                <ds-text-field label="Idioma do template" name="template_language" autocomplete="off" [ngModel]="draft().template_language" (ngModelChange)="patch({ template_language: $event })" [error]="errors()['template_language'] ?? null" />
              </div>
            </form>
          }

          <div class="actions">
            @if (s.configured) {
              @if (confirmRemove()) {
                <span class="text-footnote">Voltar à demonstração? Os envios param de sair pelo número oficial.</span>
                <button ds-button variant="ghost" size="sm" (click)="confirmRemove.set(false)">Não</button>
                <button ds-button variant="destructive" size="sm" [loading]="busy() === 'remove'" (click)="remove()">Remover número</button>
              } @else {
                <button ds-button variant="ghost" size="sm" (click)="confirmRemove.set(true)">Remover configuração</button>
              }
            }
            <span class="spacer"></span>
            @if (s.mode === 'cloud' && draft().mode === 'cloud') {
              <button ds-button variant="secondary" size="sm" [loading]="busy() === 'verify'" [disabled]="!!busy()" (click)="verify()">Testar de novo</button>
            }
            <button ds-button size="sm" [loading]="busy() === 'save'" [disabled]="!!busy()" (click)="save()">
              {{ draft().mode === 'cloud' ? 'Salvar e verificar' : 'Usar demonstração' }}
            </button>
          </div>
        </ds-glass-card>

        @if (draft().mode === 'cloud') {
          <aside class="side">
            <ds-glass-card padding="lg" class="block">
              <h2 class="m-0 text-headline">Webhook (status de entrega e "PARAR")</h2>
              <p class="m-0 mt-1 text-footnote text-fg-muted">No app da Meta, em WhatsApp › Configuração, assine o webhook "messages" com:</p>
              <div class="copy-row">
                <span class="label">URL de retorno</span>
                <code>{{ s.webhook_url }}</code>
                <button ds-button variant="ghost" size="sm" (click)="copy(s.webhook_url, 'URL do webhook')">Copiar</button>
              </div>
              <div class="copy-row">
                <span class="label">Token de verificação</span>
                @if (s.verify_token) {
                  <code>{{ s.verify_token }}</code>
                  <button ds-button variant="ghost" size="sm" (click)="copy(s.verify_token, 'Token de verificação')">Copiar</button>
                } @else {
                  <small class="text-fg-muted">Salve a configuração para gerar o token.</small>
                }
              </div>
            </ds-glass-card>
            <ds-glass-card padding="lg" class="block">
              <h2 class="m-0 text-headline">Template sugerido</h2>
              <p class="m-0 mt-1 text-footnote text-fg-muted">
                Crie no Gerenciador do WhatsApp (categoria Utilidade, pt_BR) com 5 variáveis, nesta ordem: contato, cliente,
                período, destaques e link.
              </p>
              <blockquote class="template">{{ s.template_example }}</blockquote>
              <button ds-button variant="secondary" size="sm" (click)="copy(s.template_example, 'Template')">Copiar texto</button>
            </ds-glass-card>
          </aside>
        }
      </div>
    }
  `,
  styles: `
    .back {
      color: var(--ds-accent);
      font: var(--ds-text-footnote);
      font-weight: 600;
      text-decoration: none;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      gap: var(--ds-space-5);
      align-items: start;
    }
    @media (max-width: 1080px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
    .side {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    .status-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--ds-space-3);
    }
    .status {
      padding: 2px 12px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-fill);
      font: var(--ds-text-footnote);
      font-weight: 700;
    }
    .status[data-tone='ok'] {
      background: color-mix(in srgb, var(--ds-status-healthy) 16%, transparent);
    }
    .status[data-tone='warn'] {
      background: color-mix(in srgb, var(--ds-status-attention) 18%, transparent);
    }
    .status[data-tone='bad'] {
      background: color-mix(in srgb, var(--ds-status-critical) 16%, transparent);
    }
    .result {
      margin: var(--ds-space-3) 0 0;
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: color-mix(in srgb, var(--ds-status-critical) 12%, transparent);
      font: var(--ds-text-footnote);
    }
    .result.ok {
      background: color-mix(in srgb, var(--ds-status-healthy) 14%, transparent);
    }
    .modes {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--ds-space-2);
      margin-top: var(--ds-space-5);
    }
    .mode {
      display: flex;
      align-items: flex-start;
      gap: var(--ds-space-3);
      padding: var(--ds-space-3);
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      cursor: pointer;
    }
    .mode.on {
      border-color: var(--ds-accent);
      background: var(--ds-accent-soft);
    }
    .mode span {
      display: flex;
      flex-direction: column;
      font: var(--ds-text-subhead);
    }
    .mode small {
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
    }
    .mode input {
      margin-top: 3px;
      accent-color: var(--ds-accent);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      margin-top: var(--ds-space-5);
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--ds-space-3);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
      margin-top: var(--ds-space-5);
    }
    .spacer {
      flex: 1;
    }
    .copy-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
      margin-top: var(--ds-space-3);
    }
    .copy-row .label {
      width: 100%;
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    code {
      flex: 1;
      min-width: 0;
      padding: 6px 10px;
      border-radius: var(--ds-radius-sm, 8px);
      background: var(--ds-fill);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .template {
      margin: var(--ds-space-3) 0;
      padding: var(--ds-space-3);
      border-left: 3px solid var(--ds-accent);
      border-radius: var(--ds-radius-sm, 8px);
      background: var(--ds-fill);
      font: var(--ds-text-footnote);
    }
  `,
})
export class WhatsAppPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);

  protected readonly statusMeta = WHATSAPP_STATUS;
  protected readonly relativeTime = relativeTime;

  protected readonly settings = httpResource<WhatsAppResponse>(() => (this.tenant.isAdmin() ? API.whatsapp : undefined));
  protected readonly current = computed<WhatsAppSettings | null>(() => (this.settings.hasValue() ? this.settings.value().data : null));

  readonly draft = signal<WhatsAppDraft>({ mode: 'sandbox', phone_number_id: '', waba_id: '', access_token: '', app_secret: '', template_name: 'relatorio_periodico', template_language: 'pt_BR' });
  readonly errors = signal<FieldErrors>({});
  readonly busy = signal<'save' | 'verify' | 'remove' | null>(null);
  readonly result = signal<WhatsAppVerification | null>(null);
  readonly confirmRemove = signal(false);

  constructor() {
    effect(() => {
      const s = this.current();
      if (s) untracked(() => this.draft.set(whatsappDraftFrom(s)));
    });
  }

  protected setMode(mode: WhatsAppMode): void {
    this.patch({ mode });
  }

  protected patch(change: Partial<WhatsAppDraft>): void {
    this.draft.update((d) => ({ ...d, ...change }));
    for (const field of Object.keys(change)) {
      if (this.errors()[field]) {
        this.errors.update((all) => {
          const next = { ...all };
          delete next[field];
          return next;
        });
      }
    }
  }

  async save(): Promise<void> {
    const s = this.current();
    if (!s || this.busy()) return;
    const clientErrors = validateWhatsApp(this.draft(), s);
    if (Object.keys(clientErrors).length > 0) {
      this.errors.set(clientErrors);
      return;
    }

    this.busy.set('save');
    try {
      const res = await firstValueFrom(this.http.put<WhatsAppResponse>(API.whatsapp, whatsappBody(this.draft())));
      this.settings.set(res);
      this.result.set(res.verification);
      if (!res.verification) {
        this.toast.success('Demonstração ativa', { message: 'Os envios por WhatsApp são simulados, sem sair do Delta.' });
      } else if (res.verification.ok) {
        this.toast.success('Número oficial verificado', { message: res.verification.message });
      } else {
        this.toast.error('A Meta recusou as credenciais', { message: res.verification.message });
      }
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) {
        this.errors.set(fields);
      } else if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
        this.toast.error('Não foi possível salvar');
      }
    } finally {
      this.busy.set(null);
    }
  }

  async verify(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('verify');
    try {
      const res = await firstValueFrom(this.http.post<WhatsAppResponse>(API.whatsappVerify, {}));
      this.settings.set(res);
      this.result.set(res.verification);
    } catch (error) {
      const fields = extractFieldErrors(error);
      this.toast.error('Não foi possível testar', { message: fields ? Object.values(fields)[0] : undefined });
    } finally {
      this.busy.set(null);
    }
  }

  async remove(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('remove');
    try {
      await firstValueFrom(this.http.delete(API.whatsapp));
      this.confirmRemove.set(false);
      this.result.set(null);
      this.settings.reload();
      this.toast.success('Configuração removida', { message: 'O WhatsApp voltou ao modo demonstração.' });
    } catch {
      this.toast.error('Não foi possível remover');
    } finally {
      this.busy.set(null);
    }
  }

  protected async copy(text: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success('Copiado', { message: `${what} na área de transferência.` });
    } catch {
      this.toast.info('Não foi possível copiar', { message: 'Selecione o texto e copie manualmente.' });
    }
  }
}
