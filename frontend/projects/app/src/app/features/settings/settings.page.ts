import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsGlassCard, DsIcon, DsIconName } from 'design-system';
import { TenantService } from '../../core/tenant/tenant.service';

interface SettingsCard {
  link: string;
  icon: DsIconName;
  title: string;
  text: string;
}

export const SETTINGS_CARDS: readonly SettingsCard[] = [
  { link: '/equipe', icon: 'users', title: 'Equipe', text: 'Convide pessoas, defina papéis e quais projetos cada cliente vê.' },
  { link: '/configuracoes/marca', icon: 'palette', title: 'Marca', text: 'Nome, cor, logo e domínio próprio nos relatórios e links públicos.' },
  { link: '/integracoes/apps', icon: 'plug', title: 'Apps das plataformas', text: 'Credenciais da Meta, do Google, do TikTok e do LinkedIn para o login real das contas.' },
  { link: '/integracoes/whatsapp', icon: 'send', title: 'WhatsApp', text: 'Número oficial da agência para os envios automáticos.' },
  { link: '/configuracoes/ia', icon: 'sparkles', title: 'Copiloto de IA', text: 'Chave da Anthropic, liga/desliga e orçamento mensal do copiloto.' },
  { link: '/configuracoes/importar', icon: 'download', title: 'Importar do Reportei', text: 'Traga projetos e marcos da linha do tempo, com a lista de contas para reconectar.' },
  { link: '/configuracoes/api', icon: 'webhook', title: 'API e webhooks', text: 'Tokens para integrar BI e CRM e eventos em tempo real.' },
  { link: '/configuracoes/plano', icon: 'credit-card', title: 'Plano', text: 'Plano da agência, uso dos limites e franquias do mês e comparação dos planos.' },
];

/** /configuracoes — atalhos para tudo o que só dono e administrador ajustam. */
@Component({
  selector: 'app-settings-page',
  imports: [RouterLink, DsGlassCard, DsIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-8">
      <h1 class="m-0 text-large-title font-bold tracking-tight">Configurações</h1>
      <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">Ajustes da agência: equipe, marca, integrações, IA e API.</p>
    </header>

    @if (!tenant.isAdmin()) {
      <ds-glass-card padding="lg" role="note">
        <p class="m-0 text-headline">Só donos e administradores da agência acessam as configurações.</p>
      </ds-glass-card>
    } @else {
      <nav class="grid" aria-label="Configurações">
        @for (card of cards; track card.link; let i = $index) {
          <a class="card ds-glass" [routerLink]="card.link" [style.animation-delay.ms]="i * 40">
            <span class="icon" aria-hidden="true"><svg [dsIcon]="card.icon" [size]="22"></svg></span>
            <span class="text">
              <strong class="text-headline">{{ card.title }}</strong>
              <span class="text-footnote text-fg-muted">{{ card.text }}</span>
            </span>
          </a>
        }
      </nav>
    }
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: var(--ds-space-4);
    }
    .card {
      display: flex;
      align-items: flex-start;
      gap: var(--ds-space-3);
      padding: var(--ds-space-5);
      border-radius: var(--ds-radius-xl);
      color: var(--ds-text);
      text-decoration: none;
      animation: ds-fade-up var(--ds-duration-slow) var(--ds-ease-spring-gentle) both;
      transition: transform var(--ds-duration-base) var(--ds-ease-spring-gentle);
    }
    .card:hover {
      transform: translateY(-2px);
    }
    .card:focus-visible {
      outline: 2px solid var(--ds-accent);
      outline-offset: 2px;
    }
    .icon {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: color-mix(in oklch, var(--ds-accent) 14%, transparent);
      color: var(--ds-accent);
    }
    .text {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    @media (prefers-reduced-motion: reduce) {
      .card {
        animation: none;
      }
      .card:hover {
        transform: none;
      }
    }
  `,
})
export class SettingsPage {
  protected readonly tenant = inject(TenantService);
  protected readonly cards = SETTINGS_CARDS;
}
