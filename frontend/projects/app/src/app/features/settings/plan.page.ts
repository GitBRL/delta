import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsGlassCard, DsIcon, DsSkeleton } from 'design-system';
import { API, ApiEnvelope, Billing, BillingFeatureKey, BillingLimitKey, TENANT_HEADER } from '../../core/api/api.types';
import {
  LIMIT_LABELS,
  LIMIT_ORDER,
  MONTHLY_LIMITS,
  STATUS_TEXT,
  daysUntil,
  limitText,
  priceText,
  usagePct,
  usageText,
  usageTone,
} from '../../core/billing/plan-limit';
import { TenantService } from '../../core/tenant/tenant.service';

export const FEATURE_LABELS: Readonly<Record<BillingFeatureKey, string>> = {
  api: 'API pública e webhooks',
  mcp: 'Assistentes de IA (MCP)',
  white_label: 'Marca própria (domínio e selo)',
  publishing: 'Publicações',
  studio: 'Studio',
  ads_management: 'Gestão de anúncios',
};
export const FEATURE_ORDER: readonly BillingFeatureKey[] = ['publishing', 'studio', 'ads_management', 'api', 'mcp', 'white_label'];

const DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

/**
 * /configuracoes/plano (dono e administrador): plano, situação, uso de cada limite, recursos e a
 * comparação dos planos. Sem checkout por enquanto: mudar de plano é com a equipe do Delta (ADR 0031).
 */
@Component({
  selector: 'app-plan-page',
  imports: [RouterLink, DsGlassCard, DsIcon, DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-8">
      <a routerLink="/configuracoes" class="back text-footnote">← Configurações</a>
      <h1 class="m-0 mt-2 text-large-title font-bold tracking-tight">Plano</h1>
      <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
        O que a agência pode usar e quanto já usou. Ver o que existe nunca é bloqueado: os limites valem para criar coisas novas
        e para as franquias do mês.
      </p>
    </header>

    @if (!tenant.isAdmin()) {
      <ds-glass-card padding="lg" role="note">
        <p class="m-0 text-headline">Só donos e administradores da agência veem o plano.</p>
      </ds-glass-card>
    } @else if (billing.isLoading() && !billing.hasValue()) {
      <ds-glass-card padding="lg"><ds-skeleton width="40%" /><div class="mt-3"><ds-skeleton width="70%" /></div></ds-glass-card>
    } @else if (billing.error()) {
      <ds-glass-card padding="lg" role="alert"><p class="m-0">Não foi possível carregar o plano.</p></ds-glass-card>
    } @else if (data(); as b) {
      <div class="col">
        <ds-glass-card padding="lg" data-testid="plan-summary">
          <div class="summary">
            <span class="icon" aria-hidden="true"><svg dsIcon="credit-card" [size]="22"></svg></span>
            <div class="min-w-0 flex-1">
              <p class="m-0 text-caption text-fg-muted">Plano atual</p>
              <h2 class="m-0 text-title-2 font-semibold">{{ b.name }}</h2>
              <p class="m-0 mt-1 text-footnote">
                <span class="status" [class]="'status is-' + b.status">{{ statusText(b.status) }}</span>
                @if (b.status === 'trialing' && trialDays() !== null) {
                  <span data-testid="trial-days">
                    @if (!b.usable) {
                      · o teste terminou em {{ date(b.trial_ends_at) }}
                    } @else {
                      · {{ trialDays() === 0 ? 'termina hoje' : trialDays() === 1 ? 'termina amanhã' : 'faltam ' + trialDays() + ' dias' }}
                      ({{ date(b.trial_ends_at) }})
                    }
                  </span>
                } @else if (b.current_period_ends_at) {
                  <span> · período até {{ date(b.current_period_ends_at) }}</span>
                }
              </p>
            </div>
            @if (b.plan !== 'trial') {
              <p class="m-0 text-headline price">{{ price(b.price_brl) }}</p>
            }
          </div>
          @if (!b.usable) {
            <p class="m-0 mt-4 text-footnote warn" role="alert">
              {{ b.status === 'canceled' ? 'A assinatura está cancelada.' : 'O teste grátis terminou.' }}
              Nada novo pode ser criado, mas tudo o que já existe continua visível e exportável.
            </p>
          }
        </ds-glass-card>

        <ds-glass-card padding="lg">
          <h2 class="m-0 text-headline">Uso</h2>
          <ul class="usage" aria-label="Uso dos limites do plano">
            @for (key of limitOrder; track key) {
              <li class="usage-row" [attr.data-limit]="key">
                <div class="usage-head">
                  <span class="text-subhead">{{ limitLabel(key) }}@if (monthly(key)) {<span class="text-fg-muted"> do mês</span>}</span>
                  <span class="text-footnote text-fg-muted">
                    {{ usageText(key, b.usage[key] ?? 0) }} de {{ limitText(key, b.limits[key]) }}
                  </span>
                </div>
                @if (b.limits[key] === null) {
                  <p class="m-0 text-caption text-fg-muted">Sem limite neste plano.</p>
                } @else {
                  <div class="bar" role="progressbar" [attr.aria-label]="limitLabel(key)" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="pct(key)">
                    <span [class]="'fill is-' + tone(pct(key))" [style.width.%]="pct(key)"></span>
                  </div>
                }
              </li>
            }
          </ul>
        </ds-glass-card>

        <ds-glass-card padding="lg">
          <h2 class="m-0 text-headline">Recursos incluídos</h2>
          <ul class="features" aria-label="Recursos do plano atual">
            @for (key of featureOrder; track key) {
              <li [class.is-off]="!b.features[key]">
                <svg [dsIcon]="b.features[key] ? 'circle-check' : 'x'" [size]="16"></svg>
                <span>{{ featureLabel(key) }}</span>
                <span class="sr-only">{{ b.features[key] ? 'incluído' : 'não incluído' }}</span>
              </li>
            }
          </ul>
        </ds-glass-card>

        <section aria-labelledby="compare-title">
          <h2 id="compare-title" class="m-0 text-title-3 font-semibold">Comparar planos</h2>
          <div class="table-wrap mt-4">
            <table class="compare">
              <caption class="sr-only">Limites e recursos de cada plano</caption>
              <thead>
                <tr>
                  <th scope="col">Plano</th>
                  @for (p of b.plans; track p.key) {
                    <th scope="col" [class.is-current]="p.key === b.plan">
                      {{ p.name }}
                      @if (p.key === b.plan) {<span class="tag">atual</span>}
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Preço</th>
                  @for (p of b.plans; track p.key) {<td>{{ price(p.price_brl) }}</td>}
                </tr>
                @for (key of limitOrder; track key) {
                  <tr>
                    <th scope="row">{{ limitLabel(key) }}@if (monthly(key)) { (mês)}</th>
                    @for (p of b.plans; track p.key) {<td>{{ limitText(key, p.limits[key]) }}</td>}
                  </tr>
                }
                @for (key of featureOrder; track key) {
                  <tr>
                    <th scope="row">{{ featureLabel(key) }}</th>
                    @for (p of b.plans; track p.key) {
                      <td>{{ p.features[key] ? 'Sim' : '—' }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <ds-glass-card padding="lg" data-testid="plan-contact">
          <h2 class="m-0 text-headline">Mudar de plano</h2>
          <p class="m-0 mt-2 text-footnote text-fg-muted">O pagamento pela tela ainda não está disponível.</p>
          @if (!b.checkout_available) {
            <button type="button" class="contact-btn mt-4" (click)="showContact.set(true)" [attr.aria-expanded]="showContact()" data-testid="plan-contact-button">
              Falar com a equipe
            </button>
            @if (showContact()) {
              <p class="m-0 mt-3 text-subhead" role="status" data-testid="plan-contact-text">{{ b.contact }}</p>
            }
          }
        </ds-glass-card>
      </div>
    }
  `,
  styles: `
    .back { color: var(--ds-accent); text-decoration: none; }
    .col { display: flex; flex-direction: column; gap: var(--ds-space-5); }
    .summary { display: flex; align-items: center; gap: var(--ds-space-4); flex-wrap: wrap; }
    .icon {
      display: inline-grid; flex: none; place-items: center; width: 48px; height: 48px; border-radius: 14px;
      background: color-mix(in oklch, var(--ds-accent) 14%, transparent); color: var(--ds-accent);
    }
    .price { white-space: nowrap; }
    .status { font-weight: 600; }
    .status.is-active { color: var(--ds-status-healthy); }
    .status.is-trialing { color: var(--ds-accent); }
    .status.is-past_due { color: var(--ds-status-attention); }
    .status.is-canceled { color: var(--ds-status-critical); }
    .warn { color: var(--ds-status-critical); }
    .usage { list-style: none; margin: var(--ds-space-4) 0 0; padding: 0; display: grid; gap: var(--ds-space-4); }
    .usage-head { display: flex; justify-content: space-between; gap: var(--ds-space-3); flex-wrap: wrap; margin-bottom: 6px; }
    .bar { height: 8px; border-radius: 999px; background: color-mix(in oklch, var(--ds-text) 10%, transparent); overflow: hidden; }
    .fill { display: block; height: 100%; border-radius: inherit; background: var(--ds-accent); transition: width var(--ds-duration-base) var(--ds-ease-spring-gentle); }
    .fill.is-warn { background: var(--ds-status-attention); }
    .fill.is-full { background: var(--ds-status-critical); }
    .features { list-style: none; margin: var(--ds-space-4) 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--ds-space-2); }
    .features li { display: flex; align-items: center; gap: var(--ds-space-2); font: var(--ds-text-subhead); }
    .features li svg { color: var(--ds-status-healthy); flex: none; }
    .features li.is-off { color: var(--ds-text-secondary); }
    .features li.is-off svg { color: var(--ds-text-tertiary, var(--ds-text-secondary)); }
    .table-wrap { overflow-x: auto; border-radius: var(--ds-radius-lg); }
    .compare { width: 100%; min-width: 520px; border-collapse: collapse; font: var(--ds-text-footnote); }
    .compare th, .compare td { padding: 10px 12px; text-align: left; border-bottom: 1px solid color-mix(in oklch, var(--ds-text) 10%, transparent); }
    .compare thead th { font-weight: 600; }
    .compare tbody th { font-weight: 500; color: var(--ds-text-secondary); }
    .compare .is-current { color: var(--ds-accent); }
    .tag { margin-left: 6px; padding: 1px 8px; border-radius: 999px; font: var(--ds-text-caption); background: color-mix(in oklch, var(--ds-accent) 14%, transparent); }
    .contact-btn {
      border: 0; cursor: pointer; font: inherit;
      display: inline-flex; align-items: center; justify-content: center; min-height: 40px; padding: 0 18px;
      border-radius: 999px; background: var(--ds-accent); color: #fff; font-weight: 600; text-decoration: none;
    }
    .contact-btn:focus-visible { outline: 2px solid var(--ds-accent); outline-offset: 2px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  `,
})
export class PlanPage {
  protected readonly tenant = inject(TenantService);

  protected readonly billing = httpResource<ApiEnvelope<Billing>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId && this.tenant.isAdmin() ? { url: API.billing, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  });
  protected readonly data = computed(() => (this.billing.hasValue() ? this.billing.value().data : null));
  protected readonly trialDays = computed(() => {
    const d = daysUntil(this.data()?.trial_ends_at ?? null);
    return d === null ? null : Math.max(0, d);
  });

  protected readonly limitOrder = LIMIT_ORDER;
  protected readonly featureOrder = FEATURE_ORDER;
  protected readonly limitText = limitText;
  protected readonly usageText = usageText;
  protected readonly price = priceText;
  protected readonly showContact = signal(false);

  protected limitLabel(key: BillingLimitKey): string {
    return LIMIT_LABELS[key];
  }

  protected featureLabel(key: BillingFeatureKey): string {
    return FEATURE_LABELS[key];
  }

  protected monthly(key: BillingLimitKey): boolean {
    return MONTHLY_LIMITS.has(key);
  }

  protected pct(key: BillingLimitKey): number {
    const b = this.data();
    return b ? (usagePct(b.usage[key] ?? 0, b.limits[key]) ?? 0) : 0;
  }

  protected tone(p: number): string {
    return usageTone(p);
  }

  protected statusText(status: string): string {
    return STATUS_TEXT[status] ?? status;
  }

  protected date(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : DATE.format(d);
  }
}
