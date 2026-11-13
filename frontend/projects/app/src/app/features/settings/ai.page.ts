import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DsButton, DsGlassCard, DsIcon, DsSkeleton, DsTextField, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, AiStatus, ApiEnvelope } from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors } from '../../core/forms/server-errors';
import { TenantService } from '../../core/tenant/tenant.service';
import {
  AI_BUDGET,
  AiSettingsDraft,
  AiStatusStore,
  aiDraftFrom,
  aiSettingsBody,
  aiUsage,
  formatTokens,
  validateAiSettings,
} from '../ai/ai';

const SOURCE_TEXT: Readonly<Record<'agency' | 'server', string>> = {
  agency: 'Chave da agência cadastrada',
  server: 'Usando a chave do servidor',
};

/**
 * Configurações › IA (dono/admin): chave da Anthropic (só de escrita), liga/desliga e orçamento
 * mensal em tokens. A equipe usa o copiloto no editor de relatório e no projeto. ADR 0021.
 */
@Component({
  selector: 'app-ai-settings-page',
  imports: [FormsModule, RouterLink, DsButton, DsGlassCard, DsIcon, DsSkeleton, DsTextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-8">
      <a class="back" routerLink="/configuracoes">‹ Configurações</a>
      <h1 class="m-0 mt-1 text-large-title font-bold tracking-tight">Copiloto de IA</h1>
      <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
        O copiloto usa o Claude, da Anthropic, para escrever a análise dos relatórios e responder perguntas sobre os projetos,
        sempre a partir dos números calculados pelo Delta. As respostas são sugestões: a equipe revisa antes de enviar ao cliente.
      </p>
    </header>

    @if (!tenant.isAdmin()) {
      <ds-glass-card padding="lg" role="note">
        <p class="m-0 text-headline">Só donos e administradores da agência configuram o copiloto de IA.</p>
      </ds-glass-card>
    } @else if (store.loading()) {
      <ds-glass-card padding="lg"><ds-skeleton width="50%" /><ds-skeleton width="70%" /></ds-glass-card>
    } @else if (store.failed()) {
      <ds-glass-card padding="lg" role="alert">
        <p class="m-0 text-headline">Não foi possível carregar o copiloto de IA.</p>
        <button ds-button variant="secondary" size="sm" class="mt-3" (click)="store.reload()">Tentar de novo</button>
      </ds-glass-card>
    } @else if (store.status(); as s) {
      <div class="col">
        <ds-glass-card padding="lg">
          <div class="key-head">
            <span class="icon" aria-hidden="true"><svg dsIcon="sparkles" [size]="20"></svg></span>
            <div class="min-w-0 flex-1">
              <h2 class="m-0 text-headline">Chave da API da Anthropic</h2>
              <p class="m-0 text-footnote text-fg-muted" data-testid="key-source">
                {{ s.source ? sourceText[s.source] : 'Nenhuma chave cadastrada' }}
              </p>
            </div>
            <span class="chip" [attr.data-tone]="s.configured && s.enabled ? 'ok' : 'off'" role="status">
              {{ !s.configured ? 'Sem chave' : s.enabled ? 'Ligado' : 'Desligado' }}
            </span>
          </div>

          <form class="form" (submit)="$event.preventDefault(); save()" novalidate>
            <ds-text-field
              [label]="s.source === 'agency' ? 'Trocar a chave' : 'Chave da API'"
              type="password"
              name="api_key"
              autocomplete="off"
              placeholder="sk-ant-…"
              [hint]="s.source === 'agency' ? 'A chave atual nunca é exibida. Deixe em branco para mantê-la.' : 'Crie em console.anthropic.com › API Keys. Ela fica guardada criptografada e nunca é exibida de novo.'"
              [ngModel]="draft().api_key"
              (ngModelChange)="patch({ api_key: $event })"
              [error]="errors()['api_key'] ?? null"
              [maxlength]="300"
            />

            <label class="check">
              <input type="checkbox" name="enabled" [checked]="draft().enabled" (change)="patch({ enabled: $any($event.target).checked })" />
              <span>Copiloto ligado para a equipe</span>
            </label>

            <ds-text-field
              label="Orçamento mensal (tokens)"
              name="monthly_token_budget"
              inputmode="numeric"
              [hint]="'Entre ' + fmt(budgetLimits.min) + ' e ' + fmt(budgetLimits.max) + '. Ao atingir o limite, o copiloto pausa até o mês seguinte.'"
              [ngModel]="draft().budget"
              (ngModelChange)="patch({ budget: $event })"
              [error]="errors()['monthly_token_budget'] ?? null"
            />

            <div class="actions">
              <button ds-button type="submit" [loading]="saving()" [disabled]="!dirty()">Salvar</button>
              @if (dirty()) {
                <button ds-button type="button" variant="ghost" (click)="reset()">Descartar alterações</button>
              }
            </div>
          </form>

          @if (s.source === 'agency') {
            <div class="remove">
              @if (confirmingRemove()) {
                <span class="text-footnote">Remover a chave da agência? O copiloto para até uma nova chave ser cadastrada.</span>
                <button ds-button variant="ghost" size="sm" (click)="confirmingRemove.set(false)">Cancelar</button>
                <button ds-button variant="destructive" size="sm" [loading]="removing()" (click)="removeKey()">Remover chave</button>
              } @else {
                <button ds-button variant="ghost" size="sm" (click)="confirmingRemove.set(true)">Remover a chave</button>
              }
            </div>
          }
        </ds-glass-card>

        <ds-glass-card padding="lg">
          <h2 class="m-0 text-headline">Uso neste mês</h2>
          @let u = usage();
          <div
            class="bar"
            role="progressbar"
            aria-label="Uso do orçamento de IA neste mês"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-valuenow]="u.pct"
            [attr.data-tone]="u.tone"
          >
            <span [style.width.%]="u.pct"></span>
          </div>
          <p class="m-0 text-footnote text-fg-muted" data-testid="usage">
            {{ fmt(s.used_this_month) }} de {{ fmt(s.budget) }} tokens ({{ u.pct }}%).
            @if (u.tone === 'over') {
              O orçamento acabou: o copiloto volta no mês que vem ou com um orçamento maior.
            }
          </p>
        </ds-glass-card>
      </div>
    }
  `,
  styles: `
    .back {
      font: var(--ds-text-footnote);
      color: var(--ds-accent);
      text-decoration: none;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
      max-width: 720px;
    }
    .key-head {
      display: flex;
      align-items: center;
      gap: var(--ds-space-3);
      margin-bottom: var(--ds-space-4);
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
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    .check {
      display: flex;
      align-items: center;
      gap: var(--ds-space-2);
      font: var(--ds-text-subhead);
    }
    .actions,
    .remove {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .remove {
      margin-top: var(--ds-space-4);
      padding-top: var(--ds-space-4);
      border-top: 1px solid var(--ds-separator);
    }
    .bar {
      height: 10px;
      margin: var(--ds-space-3) 0 var(--ds-space-2);
      overflow: hidden;
      border-radius: var(--ds-radius-full);
      background: var(--ds-fill);
    }
    .bar span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--ds-accent);
      transition: width var(--ds-duration-slow, 0.4s) ease;
    }
    .bar[data-tone='warn'] span {
      background: var(--ds-status-attention);
    }
    .bar[data-tone='over'] span {
      background: var(--ds-status-critical);
    }
  `,
})
export class AiSettingsPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);
  protected readonly store = inject(AiStatusStore);

  protected readonly sourceText = SOURCE_TEXT;
  protected readonly budgetLimits = AI_BUDGET;
  protected readonly fmt = formatTokens;

  readonly draft = signal<AiSettingsDraft>({ api_key: '', enabled: true, budget: String(AI_BUDGET.default) });
  readonly errors = signal<FieldErrors>({});
  readonly saving = signal(false);
  readonly removing = signal(false);
  readonly confirmingRemove = signal(false);

  protected readonly usage = computed(() => {
    const s = this.store.status();
    return s ? aiUsage(s) : { pct: 0, tone: 'ok' as const };
  });
  protected readonly dirty = computed(() => {
    const s = this.store.status();
    return !!s && JSON.stringify(aiDraftFrom(s)) !== JSON.stringify(this.draft());
  });

  constructor() {
    // O rascunho segue o servidor enquanto não há edição pendente.
    let applied: string | null = null;
    effect(() => {
      const s = this.store.status();
      if (!s) return;
      untracked(() => {
        const server = aiDraftFrom(s);
        if (applied === null || JSON.stringify(this.draft()) === applied) this.draft.set(server);
        applied = JSON.stringify(server);
      });
    });
  }

  protected patch(change: Partial<AiSettingsDraft>): void {
    this.draft.update((d) => ({ ...d, ...change }));
    const field = Object.keys(change)[0] === 'budget' ? 'monthly_token_budget' : Object.keys(change)[0];
    if (field && this.errors()[field]) {
      this.errors.update((all) => {
        const next = { ...all };
        delete next[field];
        return next;
      });
    }
  }

  protected reset(): void {
    const s = this.store.status();
    if (s) this.draft.set(aiDraftFrom(s));
    this.errors.set({});
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    const errors = validateAiSettings(this.draft());
    if (Object.keys(errors).length) {
      this.errors.set(errors);
      return;
    }
    this.saving.set(true);
    const keyChanged = !!this.draft().api_key.trim();
    try {
      const res = await firstValueFrom(this.http.put<ApiEnvelope<AiStatus>>(API.ai, aiSettingsBody(this.draft())));
      // A chave não fica na memória da tela depois de enviada.
      this.draft.set(aiDraftFrom(res.data));
      this.store.set(res.data);
      this.errors.set({});
      this.toast.success('Copiloto de IA salvo', {
        message: keyChanged ? 'A chave nova fica guardada criptografada e nunca é exibida.' : undefined,
      });
    } catch (error) {
      this.handle(error, 'Não foi possível salvar');
    } finally {
      this.saving.set(false);
    }
  }

  async removeKey(): Promise<void> {
    if (this.removing()) return;
    this.removing.set(true);
    try {
      const res = await firstValueFrom(this.http.delete<ApiEnvelope<AiStatus>>(API.aiKey));
      this.store.set(res.data);
      this.toast.success('Chave removida', {
        message: res.data.configured ? 'O copiloto segue com a chave do servidor.' : 'O copiloto fica parado até uma nova chave.',
      });
    } catch (error) {
      this.handle(error, 'Não foi possível remover a chave');
    } finally {
      this.removing.set(false);
      this.confirmingRemove.set(false);
    }
  }

  private handle(error: unknown, title: string): void {
    const fields = extractFieldErrors(error);
    if (fields) {
      this.errors.set(fields);
      if (!Object.keys(fields).length) this.toast.error(title);
      return;
    }
    const status = error instanceof HttpErrorResponse ? error.status : null;
    if (status !== 403 && status !== 0 && (status ?? 500) < 500) this.toast.error(title);
  }
}
