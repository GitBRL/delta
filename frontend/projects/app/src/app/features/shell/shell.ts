import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DsIcon, DsIconName } from 'design-system';
import {
  API,
  ApiEnvelope,
  Billing,
  Branding,
  Connection,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { PlanLimitService, trialBanner } from '../../core/billing/plan-limit';
import { PlanLimitDialog } from '../../core/billing/plan-limit-dialog';
import { pollWhile } from '../../core/polling/poll-while';
import { TenantService } from '../../core/tenant/tenant.service';
import { DeltaLogo } from '../auth/delta-logo';
import { INBOX_BADGE_POLL_MS, InboxStore } from '../inbox/inbox';
import { AccountMenu, initialsOf } from './account-menu';

interface NavItem {
  readonly label: string;
  readonly icon: DsIconName;
  readonly path: string;
}

interface NavGroup {
  readonly id: string;
  /** Sem título: o bloco de abertura (Visão geral e Projetos) e o menu enxuto do cliente. */
  readonly label: string | null;
  readonly items: readonly NavItem[];
}

const NAV = {
  overview: { label: 'Visão geral', icon: 'layout-dashboard', path: '/overview' },
  projects: { label: 'Projetos', icon: 'folder-kanban', path: '/projetos' },
  reports: { label: 'Relatórios', icon: 'file-text', path: '/relatorios' },
  studio: { label: 'Studio', icon: 'presentation', path: '/studio' },
  goals: { label: 'Metas', icon: 'target', path: '/metas' },
  actions: { label: 'Ações', icon: 'list-checks', path: '/acoes' },
  posts: { label: 'Publicações', icon: 'calendar-days', path: '/publicacoes' },
  ads: { label: 'Anúncios', icon: 'megaphone', path: '/anuncios' },
  sends: { label: 'Envios', icon: 'send', path: '/envios' },
  inbox: { label: 'Conversas', icon: 'message-circle', path: '/conversas' },
  integrations: { label: 'Integrações', icon: 'plug', path: '/integracoes' },
  indicators: { label: 'Indicadores', icon: 'sigma', path: '/indicadores' },
  manual: { label: 'Dados manuais', icon: 'table', path: '/dados-manuais' },
  sync: { label: 'Sync', icon: 'refresh-cw', path: '/sync' },
  team: { label: 'Equipe', icon: 'users', path: '/equipe' },
  settings: { label: 'Configurações', icon: 'settings', path: '/configuracoes' },
} as const satisfies Record<string, NavItem>;

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    DeltaLogo,
    DsIcon,
    PlanLimitDialog,
    AccountMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  host: {
    '[class.is-client]': 'isClient()',
    '[style.--ds-accent]': 'clientAccent()',
  },
})
export class Shell {
  protected readonly tenant = inject(TenantService);

  /** Equipe da agência (o papel cliente não monta relatórios). */
  protected readonly isStaff = computed(
    () => !!this.tenant.current() && this.tenant.current()?.role !== 'client',
  );

  /** Menu agrupado por assunto; o cliente vê só o essencial, sem títulos. */
  protected readonly groups = computed<readonly NavGroup[]>(() => {
    if (!this.isStaff()) {
      return [
        { id: 'main', label: null, items: [NAV.overview, NAV.projects, NAV.posts, NAV.goals] },
      ];
    }
    const groups: NavGroup[] = [
      { id: 'main', label: null, items: [NAV.overview, NAV.projects] },
      {
        id: 'analysis',
        label: 'Análise',
        items: [NAV.reports, NAV.studio, NAV.goals, NAV.actions],
      },
      { id: 'operation', label: 'Operação', items: [NAV.posts, NAV.ads, NAV.sends, NAV.inbox] },
      {
        id: 'data',
        label: 'Dados',
        items: [NAV.integrations, NAV.indicators, NAV.manual, NAV.sync],
      },
    ];
    if (this.tenant.isAdmin()) {
      groups.push({ id: 'agency', label: 'Agência', items: [NAV.team, NAV.settings] });
    }
    return groups;
  });

  protected readonly tenantInitials = computed(() => initialsOf(this.tenant.current()?.name ?? ''));

  /** Portal do cliente: o cliente vê a marca da agência (logo, nome e cor) e um menu enxuto. */
  protected readonly isClient = computed(() => this.tenant.current()?.role === 'client');
  protected readonly branding = httpResource<ApiEnvelope<Branding>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId && this.isClient()
      ? { url: API.branding, headers: { [TENANT_HEADER]: tenantId } }
      : undefined;
  });
  protected readonly brand = computed(() =>
    this.isClient() && this.branding.hasValue() ? this.branding.value().data : null,
  );
  protected readonly clientAccent = computed(() => this.brand()?.color ?? null);

  /** Conexões da agência (equipe): avisa quando alguma conta real perdeu o acesso. */
  protected readonly connections = httpResource<ApiEnvelope<Connection[]>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId && this.isStaff()
      ? { url: API.connections, headers: { [TENANT_HEADER]: tenantId } }
      : undefined;
  });
  protected readonly expiredCount = computed(() =>
    this.connections.hasValue()
      ? this.connections.value().data.filter((c) => c.status === 'expired').length
      : 0,
  );
  protected readonly bannerDismissed = signal(false);

  /** Plano da agência (só dono e admin): banner quando o teste está acabando ou acabou. ADR 0031. */
  protected readonly billing = httpResource<ApiEnvelope<Billing>>(() => {
    const tenantId = this.tenant.currentId();
    return tenantId && this.tenant.isAdmin()
      ? { url: API.billing, headers: { [TENANT_HEADER]: tenantId } }
      : undefined;
  });
  protected readonly trial = computed(() =>
    this.billing.hasValue() ? trialBanner(this.billing.value().data) : null,
  );
  protected readonly trialDismissed = signal(false);

  /** Aviso de limite do plano (402), preenchido pelo interceptor. */
  protected readonly planLimit = inject(PlanLimitService);

  /** Conversas do WhatsApp com mensagens não lidas (equipe). */
  private readonly inbox = inject(InboxStore);
  protected readonly unread = computed(() => (this.isStaff() ? this.inbox.unread() : 0));

  constructor() {
    pollWhile(
      () => this.isStaff(),
      () => this.inbox.reload(),
      INBOX_BADGE_POLL_MS,
    );
  }

  /** Janela baixa ou celular: a navegação rola; a página atual nunca fica fora da área visível. */
  protected onActive(active: boolean, link: HTMLElement): void {
    if (active) {
      link.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }

  protected onTenantChange(event: Event): void {
    this.tenant.select((event.target as HTMLSelectElement).value);
  }
}
