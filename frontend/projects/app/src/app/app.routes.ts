import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';
import { unsavedChangesGuard } from './core/reports/unsaved-changes.guard';
import { unsavedPostGuard } from './features/publishing/unsaved-post.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Entrar · Delta',
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'cadastro',
    canActivate: [guestGuard],
    title: 'Criar conta · Delta',
    loadComponent: () => import('./features/auth/register.page').then((m) => m.RegisterPage),
  },
  {
    // Pública: quem foi convidado ainda pode não ter conta (a própria tela trata a sessão).
    path: 'convite/:token',
    title: 'Convite · Delta',
    loadComponent: () => import('./features/invitations/invitation.page').then((m) => m.InvitationPage),
  },
  {
    // Pública: relatório publicado aberto por link (sem login; a própria tela pede a senha se houver).
    path: 'r/:token',
    title: 'Relatório · Delta',
    loadComponent: () => import('./features/reports/public-report.page').then((m) => m.PublicReportPage),
  },
  {
    // Pública: aprovação de post pelo cliente, por link (sem login). Ver ADR 0028.
    path: 'aprovar/:token',
    title: 'Aprovar post · Delta',
    loadComponent: () => import('./features/publishing/approval.page').then((m) => m.ApprovalPage),
  },
  {
    // Pública: sessão hospedada do Delta Connect — o cliente final conecta as contas sem login. ADR 0032.
    path: 'conectar/:token',
    title: 'Conectar contas · Delta',
    loadComponent: () => import('./features/connect/connect-session.page').then((m) => m.ConnectSessionPage),
  },
  {
    // Pública: link "não quero mais receber" dos e-mails (parâmetros assinados pelo backend).
    path: 'descadastrar',
    title: 'Parar de receber · Delta',
    loadComponent: () => import('./features/unsubscribe/unsubscribe.page').then((m) => m.UnsubscribePage),
  },
  {
    path: 'design-system',
    title: 'Design System · Delta',
    loadComponent: () =>
      import('./features/design-system/showcase.page').then((m) => m.DesignSystemShowcasePage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      {
        path: 'overview',
        title: 'Visão geral · Delta',
        loadComponent: () => import('./features/overview/overview.page').then((m) => m.OverviewPage),
      },
      {
        path: 'projetos',
        title: 'Projetos · Delta',
        loadComponent: () => import('./features/projects/projects.page').then((m) => m.ProjectsPage),
      },
      {
        path: 'projetos/:id',
        title: 'Projeto · Delta',
        loadComponent: () =>
          import('./features/projects/project-detail.page').then((m) => m.ProjectDetailPage),
      },
      {
        path: 'indicadores',
        title: 'Indicadores · Delta',
        loadComponent: () => import('./features/indicators/indicators.page').then((m) => m.IndicatorsPage),
      },
      {
        path: 'indicadores/novo',
        title: 'Novo indicador · Delta',
        loadComponent: () =>
          import('./features/indicators/indicator-editor.page').then((m) => m.IndicatorEditorPage),
      },
      {
        path: 'indicadores/:id',
        title: 'Indicador · Delta',
        loadComponent: () =>
          import('./features/indicators/indicator-editor.page').then((m) => m.IndicatorEditorPage),
      },
      {
        path: 'integracoes',
        title: 'Integrações · Delta',
        loadComponent: () =>
          import('./features/integrations/integrations.page').then((m) => m.IntegrationsPage),
      },
      {
        path: 'integracoes/apps',
        title: 'Apps das plataformas · Delta',
        loadComponent: () =>
          import('./features/integrations/platform-apps.page').then((m) => m.PlatformAppsPage),
      },
      {
        path: 'integracoes/whatsapp',
        title: 'WhatsApp · Delta',
        loadComponent: () => import('./features/integrations/whatsapp.page').then((m) => m.WhatsAppPage),
      },
      {
        path: 'envios',
        title: 'Envios · Delta',
        loadComponent: () => import('./features/automations/automations.page').then((m) => m.AutomationsPage),
      },
      {
        path: 'envios/novo',
        title: 'Novo envio · Delta',
        loadComponent: () =>
          import('./features/automations/automation-editor.page').then((m) => m.AutomationEditorPage),
      },
      {
        path: 'envios/:id',
        title: 'Envio · Delta',
        loadComponent: () =>
          import('./features/automations/automation-editor.page').then((m) => m.AutomationEditorPage),
      },
      {
        path: 'relatorios',
        title: 'Relatórios · Delta',
        loadComponent: () => import('./features/reports/reports.page').then((m) => m.ReportsPage),
      },
      {
        path: 'relatorios/versoes/:id',
        title: 'Relatório publicado · Delta',
        loadComponent: () => import('./features/reports/snapshot.page').then((m) => m.SnapshotPage),
      },
      {
        path: 'relatorios/:id',
        title: 'Montar relatório · Delta',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/reports/report-editor.page').then((m) => m.ReportEditorPage),
      },
      {
        path: 'publicacoes',
        title: 'Publicações · Delta',
        loadComponent: () => import('./features/publishing/publishing.page').then((m) => m.PublishingPage),
      },
      {
        path: 'publicacoes/novo',
        title: 'Novo post · Delta',
        canDeactivate: [unsavedPostGuard],
        loadComponent: () => import('./features/publishing/post-editor.page').then((m) => m.PostEditorPage),
      },
      {
        path: 'publicacoes/:id',
        title: 'Post · Delta',
        canDeactivate: [unsavedPostGuard],
        loadComponent: () => import('./features/publishing/post-editor.page').then((m) => m.PostEditorPage),
      },
      {
        path: 'metas',
        title: 'Metas · Delta',
        loadComponent: () => import('./features/goals/goals.page').then((m) => m.GoalsPage),
      },
      {
        path: 'dados-manuais',
        title: 'Dados manuais · Delta',
        loadComponent: () => import('./features/manual/manual-metrics.page').then((m) => m.ManualMetricsPage),
      },
      {
        path: 'acoes',
        title: 'Ações · Delta',
        loadComponent: () => import('./features/actions/actions.page').then((m) => m.ActionsPage),
      },
      {
        path: 'configuracoes',
        title: 'Configurações · Delta',
        loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
      {
        path: 'configuracoes/marca',
        title: 'Marca · Delta',
        loadComponent: () => import('./features/settings/branding.page').then((m) => m.BrandingPage),
      },
      {
        path: 'configuracoes/ia',
        title: 'Copiloto de IA · Delta',
        loadComponent: () => import('./features/settings/ai.page').then((m) => m.AiSettingsPage),
      },
      {
        path: 'configuracoes/importar',
        title: 'Importar do Reportei · Delta',
        loadComponent: () => import('./features/settings/import.page').then((m) => m.ImportPage),
      },
      {
        path: 'configuracoes/plano',
        title: 'Plano · Delta',
        loadComponent: () => import('./features/settings/plan.page').then((m) => m.PlanPage),
      },
      {
        path: 'studio',
        title: 'Studio · Delta',
        loadComponent: () => import('./features/studio/studio.page').then((m) => m.StudioPage),
      },
      {
        path: 'studio/:id',
        title: 'Apresentação · Delta',
        loadComponent: () => import('./features/studio/presentation.page').then((m) => m.PresentationPage),
      },
      {
        path: 'anuncios',
        title: 'Anúncios · Delta',
        loadComponent: () => import('./features/ads/ads.page').then((m) => m.AdsPage),
      },
      {
        path: 'conversas',
        title: 'Conversas · Delta',
        loadComponent: () => import('./features/inbox/inbox.page').then((m) => m.InboxPage),
      },
      {
        path: 'configuracoes/api',
        title: 'API e webhooks · Delta',
        loadComponent: () => import('./features/settings/api.page').then((m) => m.ApiPage),
      },
      {
        path: 'sync',
        title: 'Sync · Delta',
        loadComponent: () => import('./features/sync/sync.page').then((m) => m.SyncPage),
      },
      {
        path: 'conta',
        title: 'Minha conta · Delta',
        loadComponent: () => import('./features/account/account.page').then((m) => m.AccountPage),
      },
      {
        path: 'equipe',
        title: 'Equipe · Delta',
        loadComponent: () => import('./features/team/team.page').then((m) => m.TeamPage),
      },
      // Aliases em inglês (nomes usados no contrato da API).
      { path: 'integrations', redirectTo: 'integracoes' },
      { path: 'projects/:id', redirectTo: 'projetos/:id' },
    ],
  },
  { path: '**', redirectTo: '' },
];
