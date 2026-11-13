import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DsButton, DsGlassCard, DsIcon, DsSkeleton, DsTextField, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, Branding, DomainVerification } from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors } from '../../core/forms/server-errors';
import { TenantService } from '../../core/tenant/tenant.service';
import { ReportView } from '../reports/report-view';
import {
  BrandingDraft,
  DEFAULT_BRAND_COLOR,
  HEX,
  brandingBody,
  brandingDraftFrom,
  copyText,
  logoProblem,
  previewBrand,
  previewReport,
  validateBranding,
} from './settings';

/**
 * Configurações › Marca (dono/admin): o cliente final vê a agência, não o Delta.
 * Vale para o link público, o dashboard ao vivo, o PDF e os e-mails de relatório.
 */
@Component({
  selector: 'app-branding-page',
  imports: [FormsModule, RouterLink, DsButton, DsGlassCard, DsIcon, DsSkeleton, DsTextField, ReportView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-8">
      <a class="back" routerLink="/configuracoes">‹ Configurações</a>
      <h1 class="m-0 mt-1 text-large-title font-bold tracking-tight">Marca da agência</h1>
      <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
        Seu nome, cor e logo no link público, no dashboard ao vivo, no PDF e nos e-mails de relatório. O cliente final vê a
        sua agência, não o Delta.
      </p>
    </header>

    @if (!tenant.isAdmin()) {
      <ds-glass-card padding="lg" role="note">
        <p class="m-0 text-headline">Só donos e administradores da agência configuram a marca.</p>
      </ds-glass-card>
    } @else if (branding.isLoading() && !branding.hasValue()) {
      <ds-glass-card padding="lg"><ds-skeleton width="50%" /><ds-skeleton width="70%" /></ds-glass-card>
    } @else if (branding.error() && !branding.hasValue()) {
      <ds-glass-card padding="lg" role="alert">
        <p class="m-0 text-headline">Não foi possível carregar a marca.</p>
        <button ds-button variant="secondary" size="sm" class="mt-3" (click)="branding.reload()">Tentar de novo</button>
      </ds-glass-card>
    } @else if (saved(); as b) {
      <div class="layout">
        <div class="col">
          <ds-glass-card padding="lg">
            <form class="form" (submit)="$event.preventDefault(); save()" novalidate>
              <ds-text-field
                label="Nome de exibição"
                name="display_name"
                [placeholder]="tenant.current()?.name ?? ''"
                hint="Em branco, usa o nome da agência."
                [ngModel]="draft().display_name"
                (ngModelChange)="patch({ display_name: $event })"
                [error]="errors()['display_name'] ?? null"
              />

              <div class="color">
                <label class="field-label" for="brand-color-picker">Cor principal</label>
                <div class="color-row">
                  <input id="brand-color-picker" type="color" [value]="pickerValue()" (input)="patch({ primary_color: $any($event.target).value })" aria-label="Escolher cor" />
                  <input
                    class="hex"
                    name="primary_color"
                    type="text"
                    maxlength="7"
                    placeholder="#0a84ff"
                    [value]="draft().primary_color"
                    (input)="patch({ primary_color: $any($event.target).value })"
                    [attr.aria-invalid]="!!errors()['primary_color']"
                    aria-label="Cor em hexadecimal"
                  />
                  @if (draft().primary_color) {
                    <button type="button" class="link" (click)="patch({ primary_color: '' })">Usar a padrão</button>
                  }
                </div>
                @if (errors()['primary_color']) {
                  <small class="error" role="alert">{{ errors()['primary_color'] }}</small>
                }
              </div>

              <ds-text-field
                label="E-mail para respostas (opcional)"
                type="email"
                name="email_reply_to"
                hint="Quando o cliente responde um relatório por e-mail, a resposta vai para cá."
                [ngModel]="draft().email_reply_to"
                (ngModelChange)="patch({ email_reply_to: $event })"
                [error]="errors()['email_reply_to'] ?? null"
              />

              <label class="check">
                <input type="checkbox" name="hide_delta_badge" [checked]="draft().hide_delta_badge" (change)="patch({ hide_delta_badge: $any($event.target).checked })" />
                <span>Ocultar "Feito com Delta" nas páginas públicas e o Δ do PDF</span>
              </label>

              <div class="actions">
                <button ds-button type="submit" [loading]="saving()" [disabled]="!dirty()">Salvar marca</button>
                @if (dirty()) {
                  <button ds-button type="button" variant="ghost" (click)="reset()">Descartar alterações</button>
                }
              </div>
            </form>
          </ds-glass-card>

          <ds-glass-card padding="lg">
            <h2 class="m-0 text-headline">Logo</h2>
            <p class="m-0 mt-1 mb-3 text-footnote text-fg-muted">PNG, JPG ou WebP até 2 MB. O Delta reduz para caber em 600×200 e tira qualquer conteúdo escondido do arquivo.</p>
            <div class="logo-row">
              <div class="logo-box">
                @if (b.logo_url) {
                  <img [src]="b.logo_url" alt="Logo atual da agência" />
                } @else {
                  <svg dsIcon="image" [size]="28"></svg>
                }
              </div>
              <label class="upload" [class.busy]="uploading()">
                <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" (change)="upload($event)" [disabled]="uploading()" />
                {{ uploading() ? 'Enviando…' : b.logo_url ? 'Trocar logo' : 'Enviar logo' }}
              </label>
              @if (b.logo_url) {
                <button ds-button variant="ghost" size="sm" [loading]="removingLogo()" (click)="removeLogo()">Remover</button>
              }
            </div>
            @if (logoError()) {
              <p class="error" role="alert">{{ logoError() }}</p>
            }
          </ds-glass-card>

          <ds-glass-card padding="lg">
            <h2 class="m-0 text-headline">Domínio próprio</h2>
            <p class="m-0 mt-1 mb-3 text-footnote text-fg-muted">Ex.: relatorios.suaagencia.com.br para os links públicos.</p>
            <ds-text-field
              label="Domínio"
              name="custom_domain"
              placeholder="relatorios.suaagencia.com.br"
              [ngModel]="draft().custom_domain"
              (ngModelChange)="patch({ custom_domain: $event })"
              [error]="errors()['custom_domain'] ?? null"
            />
            @if (b.custom_domain) {
              <div class="dns">
                <p class="m-0 text-footnote">No DNS do domínio, crie um registro <strong>CNAME</strong>:</p>
                <code class="record">{{ b.custom_domain }} → {{ b.cname_target }}</code>
                <div class="actions">
                  <button ds-button variant="ghost" size="sm" (click)="copy(b.cname_target)">
                    <svg dsIcon="copy" [size]="14"></svg>
                    Copiar destino
                  </button>
                  <span class="chip" [attr.data-tone]="b.domain_status === 'verified' ? 'ok' : 'warn'" data-testid="domain-status">
                    {{ b.domain_status === 'verified' ? 'Verificado' : 'Aguardando DNS' }}
                  </span>
                  <button ds-button variant="secondary" size="sm" [loading]="verifying()" (click)="verify()">Verificar</button>
                </div>
                @if (verification(); as v) {
                  <p class="result" [class.ok]="v.ok" [attr.role]="v.ok ? 'status' : 'alert'">{{ v.message }}</p>
                }
              </div>
            } @else {
              <p class="m-0 mt-2 text-caption text-fg-subtle">Salve o domínio para ver a instrução de DNS.</p>
            }
          </ds-glass-card>
        </div>

        <aside class="preview" aria-label="Prévia da marca">
          <p class="m-0 mb-2 text-footnote font-semibold uppercase tracking-wider text-fg-subtle">Prévia</p>
          <app-report-view [data]="previewData()" [brand]="preview()" />
          <p class="m-0 mt-3 text-caption text-fg-muted" data-testid="badge-preview">
            {{ preview().hide_delta_badge ? 'Sem o selo "Feito com Delta" no rodapé.' : 'Rodapé: "Feito com Delta".' }}
          </p>
        </aside>
      </div>
    }
  `,
  styles: `
    .back {
      font: var(--ds-text-footnote);
      color: var(--ds-accent);
      text-decoration: none;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--ds-space-6);
      align-items: start;
    }
    @media (max-width: 960px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    .preview {
      position: sticky;
      top: var(--ds-space-4);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    .field-label {
      font: var(--ds-text-footnote);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .color {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .color-row {
      display: flex;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .color-row input[type='color'] {
      width: 44px;
      height: 36px;
      padding: 2px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
    }
    .hex {
      width: 110px;
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
      font-family: var(--ds-font-mono, ui-monospace, monospace);
    }
    .link {
      border: 0;
      background: none;
      color: var(--ds-accent);
      font: var(--ds-text-footnote);
      cursor: pointer;
    }
    .check {
      display: flex;
      align-items: center;
      gap: var(--ds-space-2);
      font: var(--ds-text-subhead);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .logo-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-3);
    }
    .logo-box {
      display: grid;
      place-items: center;
      width: 160px;
      height: 64px;
      border-radius: var(--ds-radius-md);
      background: #fff;
      color: var(--ds-text-tertiary);
      box-shadow: inset 0 0 0 1px var(--ds-separator);
    }
    .logo-box img {
      max-width: 140px;
      max-height: 48px;
      object-fit: contain;
    }
    .upload {
      position: relative;
      display: inline-flex;
      align-items: center;
      height: 32px;
      padding: 0 14px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-fill);
      font: var(--ds-text-footnote);
      font-weight: 600;
      cursor: pointer;
    }
    .upload input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .upload:focus-within {
      outline: 2px solid var(--ds-accent);
      outline-offset: 2px;
    }
    .upload.busy {
      opacity: 0.6;
    }
    .dns {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin-top: var(--ds-space-3);
    }
    .record {
      display: block;
      padding: 8px 12px;
      border-radius: var(--ds-radius-sm);
      background: var(--ds-fill);
      font: var(--ds-text-footnote);
      font-family: ui-monospace, monospace;
      word-break: break-all;
    }
    .chip {
      padding: 2px 10px;
      border-radius: var(--ds-radius-full);
      font: var(--ds-text-caption);
      font-weight: 600;
    }
    .chip[data-tone='ok'] {
      background: color-mix(in oklch, var(--ds-status-healthy) 16%, transparent);
      color: var(--ds-status-healthy);
    }
    .chip[data-tone='warn'] {
      background: color-mix(in oklch, var(--ds-status-attention) 18%, transparent);
      color: var(--ds-status-attention);
    }
    .result {
      margin: 0;
      font: var(--ds-text-footnote);
      color: var(--ds-status-critical);
    }
    .result.ok {
      color: var(--ds-status-healthy);
    }
    .error {
      margin: 0;
      font: var(--ds-text-footnote);
      color: var(--ds-status-critical);
    }
  `,
})
export class BrandingPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);

  readonly branding = httpResource<ApiEnvelope<Branding>>(() => (this.tenant.isAdmin() && this.tenant.currentId() ? API.branding : undefined));
  protected readonly saved = computed<Branding | null>(() => (this.branding.hasValue() ? this.branding.value().data : null));

  readonly draft = signal<BrandingDraft>({ display_name: '', primary_color: '', hide_delta_badge: false, email_reply_to: '', custom_domain: '' });
  readonly errors = signal<FieldErrors>({});
  readonly saving = signal(false);
  readonly uploading = signal(false);
  readonly removingLogo = signal(false);
  readonly verifying = signal(false);
  readonly logoError = signal<string | null>(null);
  readonly verification = signal<DomainVerification | null>(null);

  protected readonly dirty = computed(() => {
    const b = this.saved();
    return !!b && JSON.stringify(brandingDraftFrom(b)) !== JSON.stringify(this.draft());
  });
  protected readonly pickerValue = computed(() => {
    const color = this.draft().primary_color;
    return HEX.test(color) ? color.toLowerCase() : (this.saved()?.color ?? DEFAULT_BRAND_COLOR);
  });
  protected readonly preview = computed(() => {
    const b = this.saved();
    return b
      ? previewBrand(b, this.draft(), this.tenant.current()?.name ?? '', b.logo_url)
      : { name: '', color: DEFAULT_BRAND_COLOR, logo_url: null, hide_delta_badge: false };
  });
  protected readonly previewData = computed(() => previewReport(this.preview().name));

  /** Último estado do servidor aplicado ao rascunho (para não apagar uma edição em andamento). */
  private applied: string | null = null;

  constructor() {
    // O rascunho segue o servidor só quando não há edição pendente (ex.: depois de trocar o logo).
    effect(() => {
      const b = this.saved();
      if (!b) return;
      untracked(() => {
        const server = brandingDraftFrom(b);
        const pristine = this.applied === null || JSON.stringify(this.draft()) === this.applied;
        if (pristine) this.draft.set(server);
        this.applied = JSON.stringify(server);
      });
    });
  }

  protected patch(change: Partial<BrandingDraft>): void {
    this.draft.update((d) => ({ ...d, ...change }));
    const field = Object.keys(change)[0];
    if (field && this.errors()[field]) {
      this.errors.update((all) => {
        const next = { ...all };
        delete next[field];
        return next;
      });
    }
  }

  protected reset(): void {
    const b = this.saved();
    if (b) this.draft.set(brandingDraftFrom(b));
    this.errors.set({});
  }

  async save(): Promise<void> {
    const errors = validateBranding(this.draft());
    if (Object.keys(errors).length) {
      this.errors.set(errors);
      return;
    }
    this.saving.set(true);
    try {
      const res = await firstValueFrom(this.http.put<ApiEnvelope<Branding>>(API.branding, brandingBody(this.draft())));
      // O que foi salvo vira o rascunho (o servidor normaliza, ex.: a cor em minúsculas).
      this.applied = null;
      this.draft.set(brandingDraftFrom(res.data));
      this.branding.set(res);
      this.verification.set(null);
      this.toast.success('Marca salva', { message: 'Vale para os próximos links, PDFs e e-mails.' });
    } catch (error) {
      this.handle(error, 'Não foi possível salvar a marca');
    } finally {
      this.saving.set(false);
    }
  }

  async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const problem = logoProblem(file);
    if (problem) {
      this.logoError.set(problem);
      return;
    }
    this.logoError.set(null);
    this.uploading.set(true);
    const form = new FormData();
    form.append('logo', file);
    try {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<Branding>>(API.brandingLogo, form));
      this.branding.set(res);
      this.toast.success('Logo atualizado');
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) this.logoError.set(fields['logo'] ?? 'Não foi possível usar esta imagem.');
      else this.handle(error, 'Não foi possível enviar o logo');
    } finally {
      this.uploading.set(false);
    }
  }

  async removeLogo(): Promise<void> {
    this.removingLogo.set(true);
    try {
      const res = await firstValueFrom(this.http.delete<ApiEnvelope<Branding>>(API.brandingLogo));
      this.branding.set(res);
    } catch (error) {
      this.handle(error, 'Não foi possível remover o logo');
    } finally {
      this.removingLogo.set(false);
    }
  }

  async verify(): Promise<void> {
    this.verifying.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<{ data: Branding; verification: DomainVerification }>(API.brandingDomainVerify, {}),
      );
      this.branding.set({ data: res.data });
      this.verification.set(res.verification);
    } catch (error) {
      this.handle(error, 'Não foi possível verificar o domínio');
    } finally {
      this.verifying.set(false);
    }
  }

  protected async copy(text: string): Promise<void> {
    if (await copyText(text)) this.toast.success('Copiado');
    else this.toast.info('Não foi possível copiar', { message: text });
  }

  private handle(error: unknown, title: string): void {
    const fields = extractFieldErrors(error);
    if (fields) {
      this.errors.set(fields);
      return;
    }
    const status = error instanceof HttpErrorResponse ? error.status : null;
    if (status !== 403 && status !== 0 && (status ?? 500) < 500) this.toast.error(title);
  }
}
