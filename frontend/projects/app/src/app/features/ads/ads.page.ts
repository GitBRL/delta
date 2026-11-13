import { HttpClient, httpResource } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DsButton, DsGlassCard, DsIcon, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  AdCampaign,
  AdCampaignsResponse,
  AdChange,
  AdChangeBody,
  AdLevel,
  AdSet,
  AdsAccount,
  ApiEnvelope,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { isPlanLimitError } from '../../core/billing/plan-limit';
import { relativeTime } from '../../core/format/relative-time';
import { TenantService } from '../../core/tenant/tenant.service';
import {
  canActivate,
  canPause,
  changeError,
  changePct,
  changePctText,
  changeSummary,
  costPerResult,
  idempotencyKey,
  largeChangeMessage,
  levelText,
  moneyText,
  objectiveText,
  parseMoney,
  statusText,
  statusTone,
} from './ads';

interface BudgetDialog {
  level: AdLevel;
  id: string;
  name: string;
  current: number;
  value: string;
  key: string;
  /** Mensagem da trava de 50% (pede confirmação para reenviar). */
  confirm: string | null;
  error: string | null;
}

interface StatusConfirm {
  level: AdLevel;
  id: string;
  name: string;
  action: 'pause' | 'activate';
}

/**
 * /anuncios (ADR 0030): campanhas e conjuntos do Meta Ads com investimento de 7 dias; pausar,
 * ativar e mudar o orçamento diário (trava acima de 50%). Toda mudança fica no histórico e
 * vira marco na linha do tempo do projeto. Só a equipe.
 */
@Component({
  selector: 'app-ads-page',
  imports: [FormsModule, NgTemplateOutlet, DsButton, DsGlassCard, DsIcon, DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closeDialogs()' },
  template: `
    <header class="mb-8">
      <h1 class="m-0 text-large-title font-bold tracking-tight">Anúncios</h1>
      <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
        Campanhas e conjuntos do Meta Ads com o investimento dos últimos 7 dias. Pause, ative e ajuste o orçamento diário sem
        sair do Delta: cada mudança fica registrada e vira marco na linha do tempo do projeto.
      </p>
    </header>

    @if (!isStaff()) {
      <ds-glass-card padding="lg" role="note"><p class="m-0 text-headline">A gestão de anúncios é da equipe da agência.</p></ds-glass-card>
    } @else if (accounts.isLoading() && !accounts.hasValue()) {
      <ds-glass-card padding="lg"><ds-skeleton width="40%" /></ds-glass-card>
    } @else if (accounts.error()) {
      <ds-glass-card padding="lg" role="alert">
        <p class="m-0">Não foi possível carregar as contas.</p>
        <button ds-button variant="secondary" size="sm" class="mt-3" (click)="accounts.reload()">Tentar de novo</button>
      </ds-glass-card>
    } @else if (accountList().length === 0) {
      <ds-glass-card padding="lg" data-testid="ads-empty">
        <p class="m-0 text-headline">Nenhuma conta do Meta Ads conectada.</p>
        <p class="m-0 mt-2 text-footnote text-fg-muted">Conecte uma conta em Integrações para gerenciar campanhas por aqui.</p>
      </ds-glass-card>
    } @else {
      <div class="col">
        <div class="toolbar">
          <label class="field">
            <span class="label">Conta de anúncios</span>
            <select name="account" [value]="accountId()" (change)="selectAccount($any($event.target).value)">
              @for (a of accountList(); track a.id) {
                <option [value]="a.id" [selected]="a.id === accountId()">{{ a.name }}{{ a.mode === 'sandbox' ? ' (demonstração)' : '' }}</option>
              }
            </select>
          </label>
          @if (account(); as a) {
            @if (a.projects.length > 0) {
              <p class="m-0 text-footnote text-fg-muted">Projetos: {{ projectNames(a) }}</p>
            }
          }
        </div>

        @if (account()?.mode === 'sandbox') {
          <p class="m-0 note-box" role="note" data-testid="ads-sandbox">
            <svg dsIcon="info" [size]="16"></svg>
            Conta de demonstração: as campanhas são simuladas e as mudanças ficam só no Delta, sem chegar à Meta.
          </p>
        }

        <section aria-labelledby="campaigns-title">
          <div class="section-head">
            <h2 id="campaigns-title" class="m-0 text-title-3 font-semibold">Campanhas</h2>
            <button ds-button variant="ghost" size="sm" (click)="campaigns.reload()" [disabled]="campaigns.isLoading()">
              <svg dsIcon="refresh-cw" [size]="14"></svg> Atualizar
            </button>
          </div>

          @if (campaigns.isLoading() && !campaigns.hasValue()) {
            <ds-glass-card padding="lg" class="mt-4"><ds-skeleton width="70%" /><div class="mt-2"><ds-skeleton width="50%" /></div></ds-glass-card>
          } @else if (campaignsError(); as e) {
            <ds-glass-card padding="lg" class="mt-4" role="alert">
              <p class="m-0">{{ e }}</p>
              <button ds-button variant="secondary" size="sm" class="mt-3" (click)="campaigns.reload()">Tentar de novo</button>
            </ds-glass-card>
          } @else if (campaignList().length === 0) {
            <ds-glass-card padding="lg" class="mt-4"><p class="m-0 text-footnote text-fg-muted">Nenhuma campanha nesta conta.</p></ds-glass-card>
          } @else {
            <div class="table-wrap mt-4">
              <table class="campaigns">
                <caption class="sr-only">Campanhas e conjuntos, com investimento e resultados dos últimos 7 dias</caption>
                <thead>
                  <tr>
                    <th scope="col">Campanha / conjunto</th>
                    <th scope="col">Status</th>
                    <th scope="col">Objetivo</th>
                    <th scope="col">Orçamento</th>
                    <th scope="col" class="num">Investido 7d</th>
                    <th scope="col" class="num">Resultados 7d</th>
                    <th scope="col" class="num">Custo/resultado</th>
                    <th scope="col"><span class="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of campaignList(); track c.id) {
                    <tr class="campaign" [attr.data-id]="c.id">
                      <th scope="row">
                        <button
                          type="button"
                          class="expand"
                          (click)="toggle(c.id)"
                          [attr.aria-expanded]="expanded().has(c.id)"
                          [attr.aria-controls]="'adsets-' + c.id"
                          [attr.aria-label]="(expanded().has(c.id) ? 'Esconder' : 'Mostrar') + ' os conjuntos de ' + c.name"
                          [disabled]="c.adsets.length === 0"
                        >
                          <svg [dsIcon]="expanded().has(c.id) ? 'chevron-left' : 'chevron-right'" [size]="14" [class.rot]="expanded().has(c.id)"></svg>
                        </button>
                        <span class="name">{{ c.name }}</span>
                        <span class="text-caption text-fg-muted"> · {{ c.adsets.length }} {{ c.adsets.length === 1 ? 'conjunto' : 'conjuntos' }}</span>
                      </th>
                      <td><span class="st" [class]="'st is-' + tone(c.status)">{{ status(c.status) }}</span></td>
                      <td>{{ objective(c.objective) }}</td>
                      <td>
                        @if (c.daily_budget !== null) {
                          {{ money(c.daily_budget) }}/dia
                        } @else if (c.lifetime_budget !== null) {
                          <span title="Orçamento total (vitalício): ajuste no Gerenciador de Anúncios">Total: {{ money(c.lifetime_budget) }}</span>
                        } @else {
                          <span class="text-fg-muted">Orçamento nos conjuntos</span>
                        }
                      </td>
                      <td class="num">{{ money(c.spend_7d) }}</td>
                      <td class="num">{{ int(c.results_7d) }}</td>
                      <td class="num">{{ money(cpr(c)) }}</td>
                      <td class="row-actions">
                        <ng-container *ngTemplateOutlet="actions; context: { level: 'campaign', obj: c }" />
                      </td>
                    </tr>
                    @if (expanded().has(c.id)) {
                      @for (s of c.adsets; track s.id) {
                        <tr class="adset" [attr.id]="$first ? 'adsets-' + c.id : null" [attr.data-id]="s.id">
                          <th scope="row"><span class="indent">↳ {{ s.name }}</span></th>
                          <td><span class="st" [class]="'st is-' + tone(s.status)">{{ status(s.status) }}</span></td>
                          <td></td>
                          <td>
                            @if (s.daily_budget !== null) {
                              {{ money(s.daily_budget) }}/dia
                            } @else if (s.lifetime_budget !== null) {
                              Total: {{ money(s.lifetime_budget) }}
                            } @else {
                              <span class="text-fg-muted">Orçamento na campanha</span>
                            }
                          </td>
                          <td class="num">{{ money(s.spend_7d) }}</td>
                          <td class="num"></td>
                          <td class="num"></td>
                          <td class="row-actions">
                            <ng-container *ngTemplateOutlet="actions; context: { level: 'adset', obj: s }" />
                          </td>
                        </tr>
                      }
                    }
                  }
                </tbody>
              </table>
            </div>
            <p class="m-0 mt-2 text-caption text-fg-muted">
              Orçamento total (vitalício) não é alterado pelo Delta: ajuste no Gerenciador de Anúncios. Mudanças acima de
              {{ largePct() }}% no orçamento pedem confirmação, porque costumam reiniciar o aprendizado da Meta.
            </p>
          }
        </section>

        <section aria-labelledby="history-title" data-testid="ads-history">
          <h2 id="history-title" class="m-0 text-title-3 font-semibold">Histórico de mudanças</h2>
          @if (history.isLoading() && !history.hasValue()) {
            <ds-glass-card padding="lg" class="mt-4"><ds-skeleton width="50%" /></ds-glass-card>
          } @else if (historyList().length === 0) {
            <p class="m-0 mt-2 text-footnote text-fg-muted">Nenhuma mudança feita pelo Delta nesta conta ainda.</p>
          } @else {
            <ul class="history" aria-label="Mudanças">
              @for (h of historyList(); track h.id) {
                <li [class.is-failed]="h.status === 'failed'">
                  <svg [dsIcon]="h.status === 'failed' ? 'circle-exclamation-point' : 'circle-check'" [size]="16"></svg>
                  <div class="min-w-0 flex-1">
                    <p class="m-0 text-subhead">
                      <strong>{{ level(h.level) }} {{ h.object_name }}</strong>: {{ summary(h) }}
                      @if (h.status === 'failed') {<span class="text-fg-muted"> (não aplicada)</span>}
                    </p>
                    @if (h.error) {
                      <p class="m-0 text-caption failed-text">{{ h.error }}</p>
                    }
                    <p class="m-0 text-caption text-fg-muted">{{ h.created_by ?? 'Sistema' }} · {{ ago(h.created_at) }}</p>
                  </div>
                </li>
              }
            </ul>
          }
        </section>
      </div>
    }

    <ng-template #actions let-level="level" let-obj="obj">
      @if (confirming()?.id === obj.id) {
        <span class="inline-confirm">
          <span class="text-caption">{{ confirming()!.action === 'pause' ? 'Pausar?' : 'Ativar?' }}</span>
          <button ds-button size="sm" variant="ghost" (click)="confirming.set(null)">Não</button>
          <button ds-button size="sm" [variant]="confirming()!.action === 'pause' ? 'destructive' : 'primary'" [loading]="busy() === obj.id" (click)="applyStatus()">Sim</button>
        </span>
      } @else {
        @if (canPause(obj.status)) {
          <button ds-button size="sm" variant="ghost" (click)="askStatus(level, obj, 'pause')" [attr.aria-label]="'Pausar ' + obj.name">Pausar</button>
        } @else if (canActivate(obj.status)) {
          <button ds-button size="sm" variant="ghost" (click)="askStatus(level, obj, 'activate')" [attr.aria-label]="'Ativar ' + obj.name">Ativar</button>
        }
        @if (obj.daily_budget !== null) {
          <button ds-button size="sm" variant="secondary" (click)="openBudget(level, obj)" [attr.aria-label]="'Mudar o orçamento de ' + obj.name">Orçamento</button>
        }
      }
    </ng-template>

    @if (budget(); as b) {
      <div class="overlay">
        <div class="backdrop" (click)="budget.set(null)" aria-hidden="true"></div>
        <section class="panel ds-glass" role="dialog" aria-modal="true" aria-labelledby="budget-title" data-testid="budget-dialog">
          <h2 id="budget-title" class="m-0 text-title-3 font-semibold">Orçamento diário</h2>
          <p class="m-0 text-footnote text-fg-muted">{{ level(b.level) }} {{ b.name }}</p>
          <form class="form" (submit)="$event.preventDefault(); saveBudget()" novalidate>
            <p class="m-0 text-subhead">Atual: <strong>{{ money(b.current) }}</strong>/dia</p>
            <label class="field">
              <span class="label">Novo orçamento diário ({{ currency() }})</span>
              <input name="daily_budget" inputmode="decimal" autocomplete="off" [ngModel]="b.value" (ngModelChange)="patchBudget($event)" [attr.aria-invalid]="!!b.error" aria-describedby="budget-variation" />
              <small id="budget-variation" class="hint" data-testid="budget-variation">Variação: {{ variation() }}</small>
              @if (b.error) {
                <small class="error" role="alert">{{ b.error }}</small>
              }
            </label>
            @if (b.confirm) {
              <p class="m-0 warn-box" role="alert" data-testid="budget-confirm">{{ b.confirm }}</p>
            }
            <div class="actions">
              <button ds-button type="button" variant="ghost" (click)="budget.set(null)">Cancelar</button>
              <button ds-button type="submit" [loading]="busy() === b.id">{{ b.confirm ? 'Aplicar mesmo assim' : 'Aplicar' }}</button>
            </div>
          </form>
        </section>
      </div>
    }
  `,
  styles: `
    .col { display: flex; flex-direction: column; gap: var(--ds-space-6); }
    .toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--ds-space-4); }
    .field { display: flex; flex-direction: column; gap: var(--ds-space-2); min-width: 0; }
    .label { font: var(--ds-text-footnote); font-weight: 600; color: var(--ds-text-secondary); }
    select, input {
      min-height: 40px; padding: 6px 10px; border: 1px solid var(--ds-separator); border-radius: var(--ds-radius-md);
      background: var(--ds-bg-elevated); color: var(--ds-text); font: var(--ds-text-subhead); min-width: 0;
    }
    select:focus-visible, input:focus-visible { outline: 2px solid var(--ds-accent); outline-offset: 1px; }
    .hint { font: var(--ds-text-caption); color: var(--ds-text-secondary); }
    .error { font: var(--ds-text-caption); color: var(--ds-status-critical); }
    .note-box {
      display: flex; align-items: center; gap: var(--ds-space-2); padding: var(--ds-space-2) var(--ds-space-3);
      border-radius: var(--ds-radius-md); background: color-mix(in srgb, var(--ds-accent) 12%, transparent); font: var(--ds-text-footnote);
    }
    .warn-box {
      padding: var(--ds-space-3); border-radius: var(--ds-radius-md); font: var(--ds-text-footnote);
      background: color-mix(in srgb, var(--ds-status-attention) 16%, transparent); border-left: 4px solid var(--ds-status-attention);
    }
    .section-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--ds-space-3); }
    .table-wrap { overflow-x: auto; border-radius: var(--ds-radius-lg); }
    .campaigns { width: 100%; min-width: 860px; border-collapse: collapse; font: var(--ds-text-footnote); }
    .campaigns th, .campaigns td { padding: 10px 8px; text-align: left; vertical-align: middle; border-bottom: 1px solid var(--ds-separator); }
    .campaigns thead th { font-weight: 600; color: var(--ds-text-secondary); white-space: nowrap; }
    .campaigns tbody th { font-weight: 500; }
    .campaigns .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .adset { background: color-mix(in oklch, var(--ds-text) 3%, transparent); }
    .indent { padding-left: 28px; color: var(--ds-text-secondary); }
    .expand {
      display: inline-grid; place-items: center; width: 24px; height: 24px; margin-right: 4px; border: 0; border-radius: 6px;
      background: transparent; color: var(--ds-text-secondary); cursor: pointer; vertical-align: middle;
    }
    .expand:disabled { opacity: 0.3; cursor: default; }
    .expand:focus-visible { outline: 2px solid var(--ds-accent); }
    .rot { transform: rotate(-90deg); }
    .name { font-weight: 600; }
    .st { display: inline-block; padding: 1px 8px; border-radius: 999px; font: var(--ds-text-caption); font-weight: 600; white-space: nowrap; }
    .st.is-active { color: var(--ds-status-healthy); background: color-mix(in oklch, var(--ds-status-healthy) 14%, transparent); }
    .st.is-paused { color: var(--ds-text-secondary); background: color-mix(in oklch, var(--ds-text) 8%, transparent); }
    .st.is-issue { color: var(--ds-status-critical); background: color-mix(in oklch, var(--ds-status-critical) 14%, transparent); }
    .st.is-other { color: var(--ds-status-attention); background: color-mix(in oklch, var(--ds-status-attention) 14%, transparent); }
    .row-actions { white-space: nowrap; text-align: right; }
    .row-actions button + button { margin-left: 4px; }
    .inline-confirm { display: inline-flex; align-items: center; gap: 4px; }
    .history { list-style: none; margin: var(--ds-space-4) 0 0; padding: 0; display: flex; flex-direction: column; }
    .history li { display: flex; gap: var(--ds-space-3); padding: var(--ds-space-3) 0; border-bottom: 1px solid var(--ds-separator); }
    .history li svg { flex: none; margin-top: 2px; color: var(--ds-status-healthy); }
    .history li.is-failed svg, .failed-text { color: var(--ds-status-critical); }
    .overlay { position: fixed; inset: 0; z-index: var(--ds-z-overlay, 50); display: grid; place-items: center; padding: var(--ds-space-4); }
    .backdrop { position: absolute; inset: 0; background: rgb(0 0 0 / 0.35); backdrop-filter: blur(4px); }
    .panel { position: relative; display: flex; flex-direction: column; gap: var(--ds-space-3); width: min(440px, 100%); padding: var(--ds-space-6); border-radius: var(--ds-radius-xl); }
    .form { display: flex; flex-direction: column; gap: var(--ds-space-4); }
    .actions { display: flex; justify-content: flex-end; gap: var(--ds-space-2); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  `,
})
export class AdsPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);

  protected readonly isStaff = computed(() => !!this.tenant.current() && this.tenant.current()?.role !== 'client');

  protected readonly accounts = httpResource<ApiEnvelope<AdsAccount[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId && this.isStaff() ? { url: API.adsAccounts, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });
  protected readonly accountList = computed(() => (this.accounts.hasValue() ? this.accounts.value().data : []));
  private readonly chosen = signal<string | null>(null);
  protected readonly accountId = computed(() => {
    const list = this.accountList();
    const chosen = this.chosen();
    return list.find((a) => a.id === chosen)?.id ?? list[0]?.id ?? null;
  });
  protected readonly account = computed(() => this.accountList().find((a) => a.id === this.accountId()) ?? null);

  protected readonly campaigns = httpResource<AdCampaignsResponse>(() => {
    const tenantId = this.tenant.currentId();
    const id = this.accountId();
    return tenantId && id ? { url: API.adsCampaigns(id), headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });
  protected readonly campaignList = computed<AdCampaign[]>(() => (this.campaigns.hasValue() ? this.campaigns.value().data : []));
  protected readonly currency = computed(() => (this.campaigns.hasValue() ? this.campaigns.value().meta.currency : this.account()?.currency) || 'BRL');
  protected readonly largePct = computed(() => (this.campaigns.hasValue() ? this.campaigns.value().meta.large_change_pct : 50));
  protected readonly campaignsError = computed(() => {
    const e = this.campaigns.error();
    if (!e) return null;
    return changeError(e) ?? 'Não foi possível carregar as campanhas.';
  });

  protected readonly history = httpResource<ApiEnvelope<AdChange[]>>(() => {
    const tenantId = this.tenant.currentId();
    const id = this.accountId();
    return tenantId && id ? { url: API.adsChanges, params: { account_id: id }, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });
  protected readonly historyList = computed(() => (this.history.hasValue() ? this.history.value().data : []));

  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly confirming = signal<StatusConfirm | null>(null);
  protected readonly budget = signal<BudgetDialog | null>(null);
  protected readonly busy = signal<string | null>(null);

  protected readonly variation = computed(() => {
    const b = this.budget();
    if (!b) return '—';
    const next = parseMoney(b.value);
    return next === null ? '—' : changePctText(changePct(b.current, next));
  });

  protected readonly canPause = canPause;
  protected readonly canActivate = canActivate;

  constructor() {
    // Trocar de conta fecha o que estava aberto.
    effect(() => {
      this.accountId();
      untracked(() => {
        this.expanded.set(new Set());
        this.confirming.set(null);
        this.budget.set(null);
      });
    });
  }

  protected selectAccount(id: string): void {
    this.chosen.set(id);
  }

  protected projectNames(a: AdsAccount): string {
    return a.projects.map((p) => p.name).join(', ');
  }

  protected toggle(id: string): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected askStatus(level: AdLevel, obj: AdCampaign | AdSet, action: 'pause' | 'activate'): void {
    this.confirming.set({ level, id: obj.id, name: obj.name, action });
  }

  protected async applyStatus(): Promise<void> {
    const c = this.confirming();
    if (!c) return;
    const ok = await this.send({ level: c.level, object_id: c.id, action: c.action }, idempotencyKey(), c.id);
    if (ok) {
      this.confirming.set(null);
      this.toast.success(c.action === 'pause' ? `${c.name} pausada` : `${c.name} ativada`);
    }
  }

  protected openBudget(level: AdLevel, obj: AdCampaign | AdSet): void {
    if (obj.daily_budget === null) return;
    this.confirming.set(null);
    this.budget.set({
      level,
      id: obj.id,
      name: obj.name,
      current: obj.daily_budget,
      value: String(obj.daily_budget).replace('.', ','),
      key: idempotencyKey(),
      confirm: null,
      error: null,
    });
  }

  protected patchBudget(value: string): void {
    // Valor novo = pedido novo: a confirmação da trava vale só para o valor confirmado.
    this.budget.update((b) => (b ? { ...b, value, confirm: null, error: null } : b));
  }

  protected async saveBudget(): Promise<void> {
    const b = this.budget();
    if (!b) return;
    const amount = parseMoney(b.value);
    if (amount === null || amount < 1) {
      this.budget.set({ ...b, error: 'Informe um valor de pelo menos 1,00.' });
      return;
    }
    if (amount === b.current) {
      this.budget.set({ ...b, error: 'O valor é igual ao atual.' });
      return;
    }

    const body: AdChangeBody = { level: b.level, object_id: b.id, action: 'budget', daily_budget: amount, ...(b.confirm ? { confirm_large_change: true } : {}) };
    const result = await this.send(body, b.key, b.id, (error) => {
      const large = largeChangeMessage(error);
      const current = this.budget();
      if (!current) return true;
      if (large && !current.confirm) {
        this.budget.set({ ...current, confirm: large, error: null });
        return true;
      }
      this.budget.set({ ...current, error: changeError(error) ?? 'Não foi possível mudar o orçamento.' });
      return true;
    });
    if (result) {
      this.budget.set(null);
      this.toast.success('Orçamento atualizado', { message: `${b.name}: ${this.money(amount)}/dia` });
    }
  }

  /** Envia a mudança; recarrega campanhas e histórico. `onError` devolve true se tratou o erro. */
  private async send(body: AdChangeBody, key: string, busyId: string, onError?: (error: unknown) => boolean): Promise<boolean> {
    const accountId = this.accountId();
    if (!accountId) return false;
    const projectId = this.account()?.projects.length === 1 ? this.account()!.projects[0].id : null;
    this.busy.set(busyId);
    try {
      await firstValueFrom(
        this.http.post<ApiEnvelope<AdChange>>(API.adsChange(accountId), { ...body, ...(projectId ? { project_id: projectId } : {}) }, { headers: { 'Idempotency-Key': key } }),
      );
      this.campaigns.reload();
      this.history.reload();
      return true;
    } catch (error) {
      if (isPlanLimitError(error)) return false; // o diálogo do plano explica
      if (onError?.(error)) {
        this.history.reload();
        return false;
      }
      this.toast.error('Não foi possível aplicar', { message: changeError(error) ?? undefined });
      this.history.reload();
      return false;
    } finally {
      this.busy.set(null);
    }
  }

  protected closeDialogs(): void {
    this.budget.set(null);
    this.confirming.set(null);
  }

  protected status(s: string): string {
    return statusText(s);
  }

  protected tone(s: string): string {
    return statusTone(s);
  }

  protected objective(o: string | null): string {
    return objectiveText(o);
  }

  protected money(v: number | null): string {
    return moneyText(v, this.currency());
  }

  protected int(v: number): string {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v);
  }

  protected cpr(c: AdCampaign): number | null {
    return costPerResult(c.spend_7d, c.results_7d);
  }

  protected level(l: AdLevel): string {
    return levelText(l);
  }

  protected summary(c: AdChange): string {
    return changeSummary(c, this.currency());
  }

  protected ago(iso: string): string {
    return relativeTime(iso);
  }
}
