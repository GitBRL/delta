/** Contrato da API do backend (Fase 0 + Fase 1: métricas e indicadores personalizados). */

export interface ApiEnvelope<T> {
  data: T;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  two_factor_enabled: boolean;
  tenants: TenantSummary[];
}

export interface Project {
  id: string;
  name: string;
  niche: string | null;
  /** Perfil de negócio que calibra o semáforo de atenção (ausente em respostas antigas). */
  goals?: ProjectGoals;
  created_at: string;
}

/** Metas do projeto (§7.2). Nulo = não informado. */
export interface ProjectGoals {
  /** Margem bruta em % (0 < x ≤ 100). ROAS de equilíbrio = 100 ÷ margem. */
  gross_margin_pct: number | null;
  /** Meta de custo por conversão, em R$. */
  target_cpa: number | null;
  target_roas: number | null;
}

/** PATCH /api/projects/{id} */
export interface UpdateProjectBody {
  name?: string;
  niche?: string | null;
  goals?: Partial<ProjectGoals>;
}

export interface CreateProjectBody {
  name: string;
  niche?: string | null;
}

export interface LoginBody {
  email: string;
  password: string;
  remember: boolean;
}

export interface LoginResponse {
  two_factor: boolean;
}

export type TwoFactorBody = { code: string } | { recovery_code: string };

export interface RegisterBody {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  company_name: string;
}

/** Corpo de erro 422 do Laravel. */
export interface ValidationErrorBody {
  message: string;
  errors: Record<string, string[]>;
}

/* ---------- Fase 1: integrações e métricas ---------- */

export type ProviderCategory = 'ads' | 'social' | 'analytics' | 'seo' | 'local';
export type ConnectionMode = 'sandbox' | 'live';
export type ConnectionStatus = 'active' | 'syncing' | 'error' | 'expired';
export type AccountKind = 'ad_account' | 'page' | 'property' | 'profile' | 'site' | 'channel' | 'location';
export type MetricUnit = 'count' | 'currency' | 'percent' | 'decimal' | 'duration';
export type MetricKind = 'additive' | 'snapshot' | 'non_additive' | 'derived';
export type MetricDirection = 'higher_is_better' | 'lower_is_better' | 'neutral';
export type MetricSentiment = 'positive' | 'negative' | 'neutral';
export type CompareMode = 'previous_period' | 'previous_year' | 'none';

export interface Provider {
  key: string;
  name: string;
  category: ProviderCategory;
  available_modes: ConnectionMode[];
  metrics_count: number;
  /** Chaves de métricas em destaque, na ordem de exibição (ex.: "meta_ads:spend"). */
  featured_metrics: string[];
  /** Observação sobre a conexão real (credenciais pendentes, coleta em desenvolvimento...). */
  live_note?: string | null;
  /** App OAuth que faz o login real desta plataforma (configurado em Integrações › Apps das plataformas). */
  app_vendor?: AppVendor | null;
}

export interface MetricDefinition {
  key: string;
  provider: string;
  label: string;
  description: string;
  unit: MetricUnit;
  kind: MetricKind;
  direction: MetricDirection;
  decimals: number;
  featured: boolean;
}

export interface Account {
  id: string;
  provider: string;
  name: string;
  kind: AccountKind;
  currency: string | null;
  external_id: string;
}

export interface Connection {
  id: string;
  provider: string;
  mode: ConnectionMode;
  status: ConnectionStatus;
  label: string;
  last_synced_at: string | null;
  last_error: string | null;
  /** Fim do acesso da conta real (Meta: ~60 dias). Nulo em demonstração ou com renovação automática. */
  expires_at?: string | null;
  /** Conta real com acesso perto do fim: reconectar antes de parar. */
  expiring_soon?: boolean;
  accounts: Account[];
}

export interface CreateConnectionBody {
  provider: string;
  mode: ConnectionMode;
}

export interface UpdateProjectAccountsBody {
  account_ids: string[];
}

export interface DateRange {
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD */
  end: string;
}

export interface MetricsQueryBody extends DateRange {
  compare: CompareMode;
  metrics: string[];
  series: boolean;
}

export interface SeriesPoint {
  date: string;
  value: number | null;
}

export interface MetricResult {
  key: string;
  label: string;
  unit: MetricUnit;
  direction: MetricDirection;
  decimals: number;
  /** null = projeto sem conta daquele canal. */
  value: number | null;
  previous: number | null;
  /** Variação percentual em 0–100 (ex.: 12.5 = +12,5%). */
  change_pct: number | null;
  sentiment: MetricSentiment;
  approximate: boolean;
  series: SeriesPoint[];
  previous_series: SeriesPoint[];
}

export interface MetricsQueryResult {
  period: DateRange;
  comparison: DateRange | null;
  metrics: MetricResult[];
}

/* ---------- Fase 1: indicadores personalizados (§7.1) ---------- */

export interface CustomMetric {
  id: string;
  /** Gerada pelo backend na criação a partir do nome; nunca muda (ex.: "custom:roas_combinado"). */
  key: string;
  name: string;
  description: string | null;
  formula: string;
  unit: MetricUnit;
  direction: MetricDirection;
  /** 0–6 */
  decimals: number;
  /** Plataformas referenciadas pela fórmula (direta ou indiretamente). */
  providers: string[];
  created_at: string;
  updated_at: string;
}

export interface CustomMetricBody {
  name: string;
  description?: string | null;
  formula: string;
  unit: MetricUnit;
  direction: MetricDirection;
  decimals: number;
}

export interface CustomMetricTemplate {
  name: string;
  description: string;
  formula: string;
  unit: MetricUnit;
  direction: MetricDirection;
  decimals: number;
}

export interface CustomMetricPreviewBody extends DateRange {
  formula: string;
  unit: MetricUnit;
  direction: MetricDirection;
  decimals: number;
  project_id: string;
  compare: CompareMode;
}

/* ---------- Fase 1: semáforo de atenção (§7.2) ---------- */

/** Estado de uma métrica no semáforo (mesmos valores do StatusLevel do design system). */
export type AttentionStatus = 'critical' | 'attention' | 'opportunity' | 'healthy';
/** Sinais só existem para o que pede ação ou é oportunidade. */
export type SignalStatus = Exclude<AttentionStatus, 'healthy'>;

export interface AttentionSignal {
  /** Id da regra (ex.: "meta_ads.roas_below_breakeven"). */
  rule: string;
  /** Métrica de que o sinal fala (ex.: "meta_ads:roas"). */
  metric: string;
  status: SignalStatus;
  title: string;
  /** O porquê, com os números que dispararam a regra (pt-BR, pronto para exibir). */
  explanation: string;
  /** O que fazer. */
  suggestion: string;
  evidence: Record<string, number | string | null>;
}

export interface AttentionSummary {
  critical: number;
  attention: number;
  opportunity: number;
}

/** POST /api/projects/{id}/attention — sempre comparado com o período anterior. */
export interface AttentionResult {
  period: DateRange;
  summary: AttentionSummary;
  /** Estado por métrica avaliada, incluindo "healthy" para as que passaram. */
  statuses: Record<string, AttentionStatus>;
  /** Já ordenados do mais urgente para o menos. */
  signals: AttentionSignal[];
}

/* ---------- Apps das plataformas (credenciais OAuth da agência) ---------- */

/**
 * Dono do app OAuth: o app da Meta serve Meta Ads, Facebook e Instagram; o do Google, GA4, Google Ads,
 * Search Console, YouTube e Perfil da Empresa; o do TikTok, TikTok Ads; o do LinkedIn, LinkedIn Ads.
 */
export type AppVendor = 'meta' | 'google' | 'tiktok' | 'linkedin';

/**
 * missing = nada configurado · server = a agência não cadastrou e vale o app do servidor ·
 * unverified = cadastrado e ainda não confirmado · verified = a plataforma confirmou · invalid = a plataforma recusou.
 */
export type PlatformAppStatus = 'missing' | 'server' | 'unverified' | 'verified' | 'invalid';

export interface PlatformApp {
  vendor: AppVendor;
  /** "Meta" | "Google" | "TikTok" | "LinkedIn" */
  name: string;
  platforms: { key: string; name: string }[];
  status: PlatformAppStatus;
  source: 'agency' | 'server' | null;
  /** Só quando source = 'agency'. */
  client_id: string | null;
  /** Ex.: "••••1a2b". O segredo nunca volta ao navegador. */
  client_secret_hint: string | null;
  /** Só Google. */
  developer_token_hint: string | null;
  /** Google: true (o developer token é exigido só para o Google Ads). */
  requires_developer_token: boolean;
  verified_at: string | null;
  /** Mensagem pt-BR pronta para exibir. */
  verification_error: string | null;
  updated_at: string | null;
  /** Nome de quem salvou. */
  updated_by: string | null;
  /** Endereços para cadastrar no app da plataforma. */
  redirect_uris: string[];
  /** Console da plataforma onde o app é criado. */
  console_url: string;
  /** Plataformas do vendor ainda sem login real (ex.: google_ads sem developer token). */
  missing_platforms: string[];
}

export interface PlatformAppVerification {
  status: 'verified' | 'invalid' | 'unreachable';
  message: string;
}

/** PUT /api/platform-apps/{vendor} e POST .../verify */
export interface PlatformAppResponse {
  data: PlatformApp;
  verification: PlatformAppVerification;
}

/** Segredo e token em branco (omitidos) = mantém os atuais. */
export interface SavePlatformAppBody {
  client_id: string;
  client_secret?: string;
  developer_token?: string;
}

/* ---------- Equipe e convites ---------- */

/** Papel na agência (espelha tenant_user.role). */
export type Role = 'owner' | 'admin' | 'analyst' | 'client';
/** Dono não é convidado: vira dono por mudança de papel feita por outro dono. */
export type InvitableRole = Exclude<Role, 'owner'>;

export interface ProjectRef {
  id: string;
  name: string;
}

export interface TeamMember {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  joined_at: string;
  is_you: boolean;
  /** Só para clientes: projetos que a pessoa enxerga. */
  projects: ProjectRef[];
}

/** Convite pendente (não aceito, não revogado); expirados vêm com expired=true. */
export interface Invitation {
  id: string;
  email: string;
  role: InvitableRole;
  projects: ProjectRef[];
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  expired: boolean;
}

/** GET /api/team (só dono/admin). */
export interface Team {
  members: TeamMember[];
  invitations: Invitation[];
  /** O usuário atual é dono: pode promover a dono e mexer em outros donos. */
  can_manage_owners: boolean;
}

export interface InviteBody {
  email: string;
  role: InvitableRole;
  project_ids?: string[];
}

/** POST /api/team/invitations e /resend: o link só aparece aqui (o e-mail também é enviado). */
export interface InvitationLinkResponse {
  data: Invitation;
  invite_url: string;
}

export interface UpdateMemberBody {
  role: Role;
  project_ids?: string[];
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

/** GET /api/invitations/{token} (público). */
export interface InvitationPreview {
  tenant_name: string;
  email: string;
  role: Role;
  inviter_name: string | null;
  expires_at: string;
  status: InvitationStatus;
  /** Já existe conta com o e-mail do convite (então é entrar, não criar conta). */
  account_exists: boolean;
}

/** POST /api/invitations/{token}/accept sem sessão: cria a conta com o e-mail do convite. */
export interface AcceptInvitationBody {
  name: string;
  password: string;
  password_confirmation: string;
}

export interface AcceptedInvitation {
  tenant_id: string;
  tenant_name: string;
}

/* ---------- Fase 1: relatórios (montador, versões publicadas, links públicos) ---------- */

export type ReportPeriodPreset = 'last_7' | 'last_14' | 'last_30' | 'last_month' | 'this_month' | 'custom';
export type ReportBlockType = 'kpis' | 'table' | 'chart' | 'text' | 'attention';

export interface KpisBlock {
  id: string;
  type: 'kpis';
  title?: string;
  /** 1–12 chaves de métrica. */
  metrics: string[];
}
export interface TableBlock {
  id: string;
  type: 'table';
  title?: string;
  /** 1–20 chaves de métrica. */
  metrics: string[];
}
export interface ChartBlock {
  id: string;
  type: 'chart';
  title?: string;
  metric: string;
}
export interface TextBlock {
  id: string;
  type: 'text';
  title?: string;
  /** Até 5000 caracteres; **negrito**, linhas "- item" e linha em branco = parágrafo. */
  content: string;
}
export interface AttentionBlock {
  id: string;
  type: 'attention';
  title?: string;
  /** 1–10 sinais. */
  limit: number;
}
export type LayoutBlock = KpisBlock | TableBlock | ChartBlock | TextBlock | AttentionBlock;

export interface LayoutSection {
  id: string;
  /** 1–80 caracteres. */
  title: string;
  blocks: LayoutBlock[];
}

/** Estrutura editável do relatório (até 30 seções × 30 blocos). */
export interface ReportLayout {
  sections: LayoutSection[];
}

export interface ReportTemplate {
  key: string;
  name: string;
  description: string;
  niche: string;
  channels: string[];
}

export interface ReportSummary {
  id: string;
  title: string;
  project: { id: string; name: string; niche: string | null } | null;
  template: string | null;
  period_preset: ReportPeriodPreset;
  /** Ex.: "01/10/2026 – 31/10/2026"; nulo quando o preset ainda não tem dias com dados. */
  period_label: string | null;
  updated_at: string | null;
  last_published_at?: string | null;
  versions?: number;
}

export interface ReportFull extends ReportSummary {
  period_start: string | null;
  period_end: string | null;
  compare: CompareMode;
  layout: ReportLayout;
  created_at: string | null;
}

export interface CreateReportBody {
  project_id: string;
  title: string;
  template?: string;
  period_preset?: ReportPeriodPreset;
  period_start?: string;
  period_end?: string;
  compare?: CompareMode;
}

export interface SaveReportBody {
  title: string;
  period_preset: ReportPeriodPreset;
  period_start?: string | null;
  period_end?: string | null;
  compare: CompareMode;
  layout: ReportLayout;
}

export type RenderReportBody = Partial<SaveReportBody>;

/** Métrica renderizada no relatório (MetricResult + canal e selo do semáforo). */
export interface ReportMetric extends Omit<MetricResult, 'series' | 'previous_series'> {
  provider: string;
  provider_name: string;
  status?: AttentionStatus | null;
  series?: SeriesPoint[];
  previous_series?: SeriesPoint[];
}

export interface ReportMetricsBlockData {
  id: string;
  type: 'kpis' | 'table';
  title: string | null;
  metrics: ReportMetric[];
  /** Bloco com mais de um canal: mostrar o canal junto do rótulo. */
  mixed: boolean;
}
export interface ReportChartBlockData {
  id: string;
  type: 'chart';
  title: string | null;
  metric: ReportMetric | null;
}
export interface ReportTextBlockData {
  id: string;
  type: 'text';
  title: string | null;
  content: string;
}
export interface ReportAttentionBlockData {
  id: string;
  type: 'attention';
  title: string | null;
  summary: AttentionSummary;
  signals: AttentionSignal[];
}
export type ReportDataBlock = ReportMetricsBlockData | ReportChartBlockData | ReportTextBlockData | ReportAttentionBlockData;

/** Dados prontos para exibir (prévia, versão publicada e link público usam o mesmo formato). */
export interface ReportData {
  version: number;
  title: string;
  agency: string | null;
  project: { id: string; name: string; niche: string | null };
  period: { start: string; end: string; label: string };
  compare: CompareMode;
  comparison: DateRange | null;
  generated_at: string;
  sections: { id: string; title: string; blocks: ReportDataBlock[] }[];
}

export type PdfStatus = 'pending' | 'ready' | 'failed';

export interface SnapshotSummary {
  id: string;
  report_id: string;
  project_id: string;
  title: string;
  period: DateRange;
  comparison: DateRange | null;
  pdf_status: PdfStatus;
  pdf_error: string | null;
  active_links: number;
  created_at: string;
}

export interface Snapshot extends SnapshotSummary {
  data: ReportData;
}

export interface ShareLink {
  id: string;
  /** Link de versão publicada (números congelados). Nulo nos links ao vivo. */
  snapshot_id: string | null;
  /** Link ao vivo (dashboard): o relatório é recalculado a cada acesso. */
  report_id?: string | null;
  live?: boolean;
  protected: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  active: boolean;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

export interface CreateShareLinkBody {
  expires_in_days?: number | null;
  password?: string | null;
}

export interface CreateShareLinkResponse {
  data: ShareLink;
  /** Só aparece aqui (o backend guarda o hash). */
  url: string;
}

/** GET /api/public/reports/{token} e POST .../unlock */
export interface PublicReport {
  title: string;
  agency: string | null;
  /** Dashboard ao vivo: recalculado a cada acesso (cache de 5 min), sem PDF. */
  live?: boolean;
  /** Quando os números ao vivo foram calculados. */
  refreshed_at?: string | null;
  published_at: string;
  report: ReportData | null;
  /** Nulo nos links ao vivo. */
  pdf_status: PdfStatus | null;
  /** URL relativa assinada (10 min). Nula nos links ao vivo. */
  pdf_url: string | null;
  /** Marca da agência (white label). */
  branding?: PublicBranding;
}

/** 401 do link público protegido por senha. */
export interface PublicReportLocked {
  requires_password: true;
  title: string;
  agency: string | null;
}

/* ---------- Visão geral real (GET /api/overview) ---------- */

/** Presets aceitos pela Visão geral e pelos envios automáticos (sem "custom"). */
export type RelativePeriodPreset = Exclude<ReportPeriodPreset, 'custom'>;

export interface OverviewKpi {
  key: 'spend' | 'conversions' | 'cpa' | 'roas';
  label: string;
  unit: MetricUnit;
  direction: MetricDirection;
  decimals: number;
  value: number | null;
  previous: number | null;
  change_pct: number | null;
  sentiment: MetricSentiment;
}

export interface OverviewHealth {
  acquisition: number | null;
  engagement: number | null;
  conversion: number | null;
}

export type OverviewSignal = AttentionSignal & { project_id: string; project: string };

export type OverviewProjectStatus = AttentionStatus | 'no_data';

export interface OverviewProject {
  id: string;
  name: string;
  niche: string | null;
  status: OverviewProjectStatus;
  summary: AttentionSummary;
  headline: string;
  detail: string;
  providers: string[];
  spend: number | null;
  /** Saúde da conta 0–100 (nulo sem dados). */
  health?: number | null;
}

export interface OverviewCounts {
  projects: number;
  with_data: number;
  critical: number;
  attention: number;
  opportunity: number;
}

export interface Overview {
  period: { start: string; end: string; label: string };
  compare: CompareMode;
  generated_at: string;
  kpis: OverviewKpi[];
  health: OverviewHealth;
  radar: OverviewSignal[];
  projects: OverviewProject[];
  counts: OverviewCounts;
}

/* ---------- Contatos (com consentimento por canal) ---------- */

export type ContactChannel = 'email' | 'whatsapp';

export interface Contact {
  id: string;
  project_id: string;
  name: string;
  email: string | null;
  /** E.164 (+5511999998888). */
  phone: string | null;
  phone_display: string | null;
  role: string | null;
  email_opt_in: boolean;
  whatsapp_opt_in: boolean;
  created_at: string;
}

export interface ContactBody {
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  email_opt_in: boolean;
  whatsapp_opt_in: boolean;
}

export type ConsentSource = 'manual' | 'unsubscribe_link' | 'whatsapp_reply';

export interface ConsentRecord {
  channel: ContactChannel;
  granted: boolean;
  source: ConsentSource;
  recorded_by: string | null;
  created_at: string;
}

/* ---------- Envios automáticos (e-mail e WhatsApp) ---------- */

export type AutomationFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';
export type RunStatus = 'awaiting_approval' | 'sending' | 'sent' | 'partial' | 'failed' | 'cancelled';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';
export type MessageProvider = 'smtp' | 'meta_cloud' | 'sandbox';

export interface Automation {
  id: string;
  name: string;
  project: { id: string; name: string } | null;
  report: { id: string; title: string } | null;
  channels: ContactChannel[];
  frequency: AutomationFrequency;
  /** 1 = segunda … 7 = domingo. */
  weekday: number | null;
  /** 1–28. */
  month_day: number | null;
  /** "HH:MM", no fuso da agência. */
  send_time: string;
  schedule_label: string;
  period_preset: RelativePeriodPreset;
  message: string;
  attach_pdf: boolean;
  requires_approval: boolean;
  active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  recipients: Contact[];
  last_run: { id: string; status: RunStatus; created_at: string } | null;
}

export interface AutomationBody {
  name: string;
  /** Só na criação (o PUT não aceita). */
  report_id?: string;
  channels: ContactChannel[];
  frequency: AutomationFrequency;
  weekday?: number | null;
  month_day?: number | null;
  send_time: string;
  period_preset: RelativePeriodPreset;
  message: string;
  attach_pdf: boolean;
  requires_approval: boolean;
  active: boolean;
  recipient_ids: string[];
}

export interface RunCounts {
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
}

export interface AutomationRun {
  id: string;
  automation_id: string;
  automation_name: string | null;
  project_id: string | null;
  trigger: 'schedule' | 'manual';
  status: RunStatus;
  scheduled_for: string;
  snapshot_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  error: string | null;
  counts: RunCounts;
  created_at: string;
}

export interface RunMessage {
  id: string;
  channel: ContactChannel;
  recipient: string;
  contact_name: string | null;
  provider: MessageProvider | null;
  status: MessageStatus;
  error: string | null;
  body: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
}

export interface AutomationRunDetail extends AutomationRun {
  messages: RunMessage[];
}

export interface MessagePreviewBody {
  report_id: string;
  period_preset: RelativePeriodPreset;
  message: string;
  contact_id?: string | null;
}

export interface MessagePreview {
  subject: string;
  text: string;
  /** Parâmetros do template aprovado na Meta: contato, cliente, período, destaques, link. */
  whatsapp_params: string[];
}

/* ---------- WhatsApp da agência ---------- */

export type WhatsAppMode = 'sandbox' | 'cloud';
export type WhatsAppStatus = 'sandbox' | 'unverified' | 'verified' | 'invalid';

export interface WhatsAppSettings {
  mode: WhatsAppMode;
  configured: boolean;
  status: WhatsAppStatus;
  phone_number_id: string | null;
  waba_id: string | null;
  display_phone: string | null;
  template_name: string | null;
  template_language: string;
  has_access_token: boolean;
  has_app_secret: boolean;
  verify_token: string | null;
  webhook_url: string;
  template_example: string;
  verified_at: string | null;
  verification_error: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface WhatsAppSettingsBody {
  mode: WhatsAppMode;
  phone_number_id?: string | null;
  waba_id?: string | null;
  access_token?: string | null;
  app_secret?: string | null;
  template_name?: string | null;
  template_language?: string | null;
}

export interface WhatsAppVerification {
  ok: boolean;
  message: string;
  display_phone: string | null;
}

export interface WhatsAppResponse {
  data: WhatsAppSettings;
  verification: WhatsAppVerification | null;
}

/* ---------- Descadastro (público) ---------- */

export interface UnsubscribePreview {
  name: string;
  channel: ContactChannel;
  agency: string | null;
  subscribed: boolean;
}

/* ---------- Metas (GET /api/goals) ---------- */

export type GoalComparison = 'at_least' | 'at_most';
export type GoalPeriod = 'month' | 'week';
export type GoalStatus = 'achieved' | 'on_track' | 'at_risk' | 'off_track' | 'no_data';

export interface GoalProgress {
  goal_id: string;
  period: { key: string; label: string; start: string; end: string; closed: boolean };
  value: number | null;
  target: number;
  /** Ritmo esperado até hoje (métricas de nível: igual à meta). */
  expected: number;
  projection: number | null;
  progress_pct: number | null;
  /** Métrica que acumula no período (leads, investimento) — tem ritmo e projeção. */
  cumulative: boolean;
  days: { elapsed: number; total: number };
  status: GoalStatus;
  label: string;
  unit: MetricUnit;
  decimals: number;
}

export interface Goal {
  id: string;
  project: { id: string; name: string };
  metric_key: string;
  comparison: GoalComparison;
  target: number;
  period: GoalPeriod;
  active: boolean;
  progress: GoalProgress;
}

export interface GoalBody {
  metric_key: string;
  comparison: GoalComparison;
  target: number;
  period: GoalPeriod;
  active?: boolean;
}

/* ---------- Linha do tempo ---------- */

export type TimelineEventType =
  | 'manual'
  | 'report_published'
  | 'automation_sent'
  | 'goal_achieved'
  | 'goal_off_track'
  | 'goal_at_risk'
  | 'action_applied'
  | 'action_result'
  | 'ads_change';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  title: string;
  description: string | null;
  /** YYYY-MM-DD */
  occurred_on: string;
  metadata?: Record<string, unknown>;
  created_by?: string | null;
  manual: boolean;
}

export interface TimelineEventBody {
  title: string;
  description?: string | null;
  occurred_on: string;
}

/* ---------- Dados manuais (fonte manual) ---------- */

export type ManualAggregation = 'sum' | 'last';

export interface ManualMetric {
  id: string;
  /** "manual:vendas_na_loja" — vale em qualquer lugar que aceite métrica. */
  key: string;
  name: string;
  description: string | null;
  unit: MetricUnit;
  direction: MetricDirection;
  decimals: number;
  aggregation: ManualAggregation;
  created_at: string;
}

export interface ManualMetricBody {
  name: string;
  description?: string | null;
  unit: MetricUnit;
  direction: MetricDirection;
  decimals: number;
  aggregation: ManualAggregation;
}

export interface ManualValue {
  date: string;
  value: number;
}

export interface ManualValuesBody {
  metric_id: string;
  /** value null apaga o dia. */
  entries: { date: string; value: number | null }[];
}

export interface ManualValuesSaved {
  saved: number;
  deleted: number;
}

export interface ManualImportResult extends ManualValuesSaved {
  errors: { line: number; message: string }[];
}

/* ---------- Marca própria (white label) ---------- */

/** O que as páginas públicas e o portal do cliente usam da marca. */
export interface PublicBranding {
  name: string;
  /** Cor efetiva (#rrggbb). */
  color: string;
  /** URL RELATIVA assinada (10 min) ou null. */
  logo_url: string | null;
  hide_delta_badge: boolean;
}

export type DomainStatus = 'verified' | 'pending';

export interface Branding extends PublicBranding {
  display_name: string | null;
  primary_color: string | null;
  email_reply_to: string | null;
  custom_domain: string | null;
  domain_status: DomainStatus | null;
  cname_target: string;
}

export interface BrandingBody {
  display_name?: string | null;
  primary_color?: string | null;
  hide_delta_badge: boolean;
  email_reply_to?: string | null;
  custom_domain?: string | null;
}

export interface DomainVerification {
  ok: boolean;
  message: string;
}

/* ---------- API pública e webhooks ---------- */

export interface ApiToken {
  id: string;
  name: string;
  /** Início do token ("dlt_ab12cd"), para reconhecer. */
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  active: boolean;
  created_at: string;
}

export interface ApiTokenList {
  data: ApiToken[];
  /** Escopo → descrição. */
  scopes: Record<string, string>;
}

export interface ApiTokenBody {
  name: string;
  scopes: string[];
  expires_in_days?: number | null;
}

export interface ApiTokenCreated {
  data: ApiToken;
  /** "dlt_…" — só aparece aqui. */
  token: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  /** '*' = todos. */
  events: string[];
  active: boolean;
  failure_count: number;
  disabled_at: string | null;
  created_at: string;
}

export interface WebhookList {
  data: WebhookEndpoint[];
  /** Evento → descrição. */
  events: Record<string, string>;
}

export interface WebhookBody {
  url: string;
  description?: string | null;
  events: string[];
  active?: boolean;
}

export interface WebhookSecretResponse {
  data: WebhookEndpoint;
  /** "whsec_…" — só aparece na criação e na rotação. */
  secret: string;
}

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface WebhookDelivery {
  id: string;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
}

/* ---------- Saúde da conta ---------- */

export type HealthLevel = 'good' | 'fair' | 'poor';

export interface ProjectHealth {
  score: number;
  level: HealthLevel;
  factors: { label: string; impact: number }[];
  summary: AttentionSummary;
  history: { date: string; score: number }[];
}

/* ---------- Plano de ação ---------- */

export type ActionStatus = 'open' | 'doing' | 'done' | 'dismissed';
export type ActionFeedback = 'useful' | 'not_useful';

export interface ActionBaseline {
  value: number | null;
  start: string;
  end: string;
}

export interface ActionOutcome extends ActionBaseline {
  change_pct: number | null;
  improved: boolean | null;
}

export interface PlanAction {
  id: string;
  project: { id: string; name: string } | null;
  rule: string | null;
  metric_key: string;
  title: string;
  suggestion: string | null;
  status: ActionStatus;
  assignee: { id: string; name: string | null } | null;
  due_on: string | null;
  dismissed_reason: string | null;
  applied_at: string | null;
  baseline: ActionBaseline | null;
  outcome: ActionOutcome | null;
  measured_at: string | null;
  feedback: ActionFeedback | null;
  created_at: string;
}

export interface ActionBody {
  rule?: string | null;
  metric_key: string;
  title: string;
  suggestion?: string | null;
  assignee_id?: string | null;
  due_on?: string | null;
}

export interface ActionPatch {
  status?: ActionStatus;
  title?: string;
  assignee_id?: string | null;
  due_on?: string | null;
  dismissed_reason?: string | null;
  feedback?: ActionFeedback | null;
}

export interface StaffMember {
  id: string;
  name: string;
}

/* ---------- Copiloto de IA (ADR 0021) ---------- */

export interface AiStatus {
  enabled: boolean;
  /** Há chave utilizável (da agência ou do servidor). */
  configured: boolean;
  /** De onde vem a chave em uso. A chave em si nunca volta ao navegador. */
  source: 'agency' | 'server' | null;
  /** Orçamento mensal em tokens. */
  budget: number;
  used_this_month: number;
}

/** PUT /api/ai — `api_key` só quando for trocar a chave. */
export interface AiSettingsBody {
  api_key?: string;
  enabled: boolean;
  monthly_token_budget: number;
}

/** Resposta do copiloto: sempre uma sugestão a revisar. */
export interface AiReply {
  text: string;
  /** Todos os números do texto batem com os dados calculados. */
  verified: boolean;
  /** Números do texto que não aparecem nos dados (como o modelo escreveu). */
  unverified_numbers: string[];
  model: string;
  suggestion: true;
}

/** POST /api/reports/{id}/ai/analysis — o estado atual do editor (sobrepõe o salvo). */
export interface AiAnalysisBody {
  period_preset: ReportPeriodPreset;
  period_start: string | null;
  period_end: string | null;
  compare: CompareMode;
  layout: ReportLayout;
}

/* ---------- Importador do Reportei (ADR 0022) ---------- */

export type ImportStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ImportReconnectItem {
  project: string;
  platform: string;
  account: string;
}

export interface ImportSummary {
  projects_created?: number;
  projects_existing?: number;
  timeline_events?: number;
  reconnect?: ImportReconnectItem[];
}

export interface DataImport {
  id: string;
  source: 'reportei';
  status: ImportStatus;
  summary: ImportSummary | [];
  error: string | null;
  created_at: string | null;
}

/* ---------- Caixa de respostas do WhatsApp (ADR 0023) ---------- */

export type InboxDirection = 'in' | 'out';

export interface InboxContact {
  id: string;
  name: string;
  project_id: string | null;
}

export interface InboxConversation {
  /** E.164 com "+". */
  phone: string;
  phone_display: string;
  contact: InboxContact | null;
  last_message: { direction: InboxDirection; body: string; created_at: string | null };
  unread: number;
  /** Ainda dentro das 24 h desde a última mensagem do cliente. */
  window_open: boolean;
}

/** GET /api/whatsapp/conversations: a lista vem com o modo do WhatsApp (a simulação só existe em demonstração). */
export interface InboxListResponse {
  data: InboxConversation[];
  meta?: { mode: 'sandbox' | 'cloud' };
}

export interface InboxMessage {
  id: string;
  direction: InboxDirection;
  body: string;
  /** received (entrada) · sent, delivered, read, failed (saída). */
  status: string | null;
  created_at: string | null;
}

export interface InboxThread {
  phone: string;
  phone_display: string;
  contact: InboxContact | null;
  window_open: boolean;
  window_closes_at: string | null;
  messages: InboxMessage[];
}

/* ---------- Minha conta: 2FA e passkeys (Fortify, ADR 0025) ---------- */

/** GET /api/me/passkeys */
export interface Passkey {
  id: number | string;
  name: string;
  /** Gerenciador reconhecido pelo AAGUID (ex.: "iCloud Keychain"), quando houver. */
  authenticator: string | null;
  created_at: string;
  last_used_at: string | null;
}

/** GET /auth/user/two-factor-qr-code */
export interface TwoFactorQrCode {
  svg: string;
  url?: string;
}

/** GET /auth/user/two-factor-secret-key */
export interface TwoFactorSecretKey {
  secretKey: string;
}

/** GET /auth/user/confirmed-password-status */
export interface ConfirmedPasswordStatus {
  confirmed: boolean;
}

/* ---------- Sync para Google Sheets (ADR 0027) ---------- */

export type SyncFrequency = 'daily' | 'weekly';
export type SyncRunStatus = 'running' | 'ok' | 'error';

export interface SyncDestination {
  id: string;
  provider: 'google_sheets';
  label: string;
  mode: ConnectionMode;
  status: string;
  created_at: string;
}

/** GET /api/sync/destinations: o login real depende do app do Google da agência. */
export interface SyncDestinationList {
  meta: { modes: ConnectionMode[]; live_note: string | null };
  data: SyncDestination[];
}

export interface SheetSync {
  id: string;
  name: string;
  project: { id: string; name: string } | null;
  destination: { id: string; label: string; mode: ConnectionMode; status: string } | null;
  metrics: string[];
  days: number;
  frequency: SyncFrequency;
  active: boolean;
  spreadsheet_url: string | null;
  last_run_at: string | null;
  last_status: SyncRunStatus | null;
  last_error: string | null;
  has_preview?: boolean;
  created_at: string;
}

export interface SheetSyncPreview {
  /** Primeira linha = cabeçalho. */
  rows: (string | number | null)[][];
  total_rows: number;
}

/** GET /api/sheet-syncs/{id}: traz a prévia no lugar de `has_preview`. */
export interface SheetSyncDetail extends SheetSync {
  preview: SheetSyncPreview | null;
}

/** POST /api/sheet-syncs (PATCH: sem projeto e destino, com `active`). */
export interface SheetSyncBody {
  project_id?: string;
  connection_id?: string;
  name?: string;
  metrics?: string[];
  days?: number;
  frequency?: SyncFrequency;
  active?: boolean;
}

/* ---------- Publishing (ADR 0028) ---------- */

export type PublishNetwork = 'instagram' | 'facebook' | 'youtube';
export type PostStatus =
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled';
export type PostTargetStatus = 'pending' | 'publishing' | 'published' | 'failed';
export type MediaKind = 'image' | 'video';

export interface PublishFormat {
  key: string;
  label: string;
}

export interface PublishNetworkSpec {
  key: PublishNetwork;
  label: string;
  caption_max: number;
  formats: PublishFormat[];
}

export interface PublishAccount {
  id: string;
  network: PublishNetwork;
  name: string;
  mode: ConnectionMode;
  status: string;
}

/** GET /api/publishing/networks?project_id= */
export interface PublishingNetworks {
  networks: PublishNetworkSpec[];
  accounts: PublishAccount[];
}

/** Mídia da biblioteca. `url` é relativa e assinada (30 min): funciona em <img>/<video> sem cabeçalhos. */
export interface MediaAsset {
  id: string;
  kind: MediaKind;
  mime: string;
  url: string;
  width: number | null;
  height: number | null;
  size_bytes: number;
  original_name: string;
  project_id: string | null;
  created_at: string;
}

export interface PostTarget {
  id: string;
  network: PublishNetwork;
  format: string;
  account: { id: string; name: string; mode: ConnectionMode | null } | null;
  status: PostTargetStatus;
  permalink: string | null;
  error: string | null;
  published_at: string | null;
}

export interface PostApproval {
  link: string;
  active: boolean;
  expires_at: string;
  decided_at: string | null;
  decision: 'approved' | 'changes_requested' | null;
  comment: string | null;
  decided_by_name: string | null;
  notified: { email: number; whatsapp: number };
}

export interface Post {
  id: string;
  project: { id: string; name: string | null };
  title: string | null;
  caption: string;
  media: MediaAsset[];
  status: PostStatus;
  requires_approval: boolean;
  scheduled_at: string | null;
  published_at: string | null;
  external_reference: string | null;
  targets: PostTarget[];
  /** O que impede aprovação, agendamento e publicação (vazio = pronto). */
  problems: string[];
  /** Só a equipe recebe; para o cliente vem null. */
  approval: PostApproval | null;
  created_at: string;
  updated_at: string;
}

export interface PostTargetBody {
  network: PublishNetwork;
  format: string;
  account_id: string | null;
}

/** POST /api/posts (PATCH: sem project_id e external_reference). */
export interface PostBody {
  project_id?: string;
  title?: string | null;
  caption?: string;
  media?: string[];
  requires_approval?: boolean;
  external_reference?: string | null;
  targets?: PostTargetBody[];
}

/** PATCH /api/posts/{id} */
export interface PostUpdateResponse {
  data: Post;
  meta?: { approval_reset?: boolean };
}

/** POST /api/posts/{id}/approval */
export interface PostApprovalResponse {
  data: Post;
  meta: { link: string; notified: { email: number; whatsapp: number } };
}

export type PublicApprovalState = 'open' | 'decided' | 'expired';

/** GET /api/public/approvals/{token} */
export interface PublicApproval {
  brand: PublicBranding;
  project: { name: string | null };
  post: {
    title: string | null;
    caption: string;
    media: MediaAsset[];
    scheduled_at: string | null;
    targets: { network: PublishNetwork; network_label: string; format: string; account: string | null }[];
  };
  approval: {
    state: PublicApprovalState;
    decision: 'approved' | 'changes_requested' | null;
    comment: string | null;
    decided_at: string | null;
    expires_at: string;
  };
}

/* ---------- Delta Connect: sessão hospedada (ADR 0032) ---------- */

export interface PublicConnectPlatform {
  key: string;
  name: string;
  category: ProviderCategory;
  modes: ConnectionMode[];
  /** Nomes das contas já conectadas neste projeto (vazio = nenhuma). */
  connected_accounts: string[];
}

/** GET /api/public/connect/{token} */
export interface PublicConnectSession {
  brand: PublicBranding;
  customer: { name: string };
  expired: boolean;
  expires_at: string;
  return_url: string | null;
  platforms: PublicConnectPlatform[];
}

export interface ApprovalDecisionBody {
  decision: 'approved' | 'changes_requested';
  comment?: string;
  name?: string;
}

const seg = (id: string) => encodeURIComponent(id);

/* ---------- Studio: apresentações geradas por IA (ADR 0029) ---------- */

export type PresentationFormat = 'slides' | 'page';
export type PresentationStatus = 'generating' | 'ready' | 'error';

export interface PresentationSummary {
  id: string;
  title: string;
  format: PresentationFormat;
  status: PresentationStatus;
  error: string | null;
  project: { id: string; name: string | null };
  current_version: number;
  period_preset: ReportPeriodPreset;
  created_at: string;
  updated_at: string;
}

export interface PresentationVersion {
  number: number;
  instruction: string;
  /** Mesmo formato do relatório renderizado/snapshot. */
  rendered: ReportData;
  /** Números do texto que não batem com os dados (vazio = tudo conferido). */
  unverified_numbers: string[];
  created_at: string;
}

export interface PresentationVersionSummary {
  number: number;
  instruction: string;
  created_at: string;
  verified: boolean;
}

export interface Presentation extends PresentationSummary {
  brief: string;
  period_start: string | null;
  period_end: string | null;
  compare: CompareMode;
  version: PresentationVersion | null;
  versions: PresentationVersionSummary[];
}

/** POST /api/presentations */
export interface CreatePresentationBody {
  project_id: string;
  brief: string;
  title?: string | null;
  format: PresentationFormat;
  period_preset: ReportPeriodPreset;
  period_start?: string | null;
  period_end?: string | null;
  compare?: CompareMode;
}

/* ---------- Gestão de Meta Ads (ADR 0030) ---------- */

export interface AdsAccount {
  id: string;
  name: string;
  currency: string | null;
  mode: ConnectionMode | null;
  status: string | null;
  projects: { id: string; name: string }[];
}

export interface AdSet {
  id: string;
  name: string;
  status: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  spend_7d: number;
}

export interface AdCampaign {
  id: string;
  name: string;
  /** ACTIVE, PAUSED ou outro status efetivo da Meta. */
  status: string;
  objective: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  spend_7d: number;
  results_7d: number;
  adsets: AdSet[];
}

export interface AdCampaignsResponse {
  data: AdCampaign[];
  meta: { currency: string; mode: ConnectionMode | null; large_change_pct: number };
}

export type AdLevel = 'campaign' | 'adset';
export type AdAction = 'pause' | 'activate' | 'budget';

/** POST /api/ads/accounts/{id}/changes (com o cabeçalho Idempotency-Key). */
export interface AdChangeBody {
  level: AdLevel;
  object_id: string;
  action: AdAction;
  daily_budget?: number;
  confirm_large_change?: boolean;
  project_id?: string | null;
}

export interface AdChange {
  id: string;
  account_id?: string | null;
  project_id?: string | null;
  level: AdLevel;
  object_id: string;
  object_name: string;
  action: AdAction;
  before: { status?: string; daily_budget?: number };
  after: { status?: string; daily_budget?: number };
  status: 'applied' | 'failed';
  error: string | null;
  created_at: string;
  created_by?: string | null;
}

/* ---------- Plano e limites (ADR 0031) ---------- */

export type BillingPlanKey = 'trial' | 'essencial' | 'pro' | 'agencia';
export type BillingStatus = 'trialing' | 'active' | 'past_due' | 'canceled';
export type BillingLimitKey = 'projects' | 'seats' | 'live_connections' | 'automations' | 'whatsapp_messages' | 'ai_tokens';
export type BillingFeatureKey = 'api' | 'mcp' | 'white_label' | 'publishing' | 'studio' | 'ads_management';

/** null = sem limite. */
export type BillingLimits = Record<BillingLimitKey, number | null>;
export type BillingFeatures = Record<BillingFeatureKey, boolean>;

export interface BillingPlan {
  key: Exclude<BillingPlanKey, 'trial'>;
  name: string;
  price_brl: number | null;
  limits: BillingLimits;
  features: BillingFeatures;
}

export interface Billing {
  plan: BillingPlanKey;
  name: string;
  status: BillingStatus;
  usable: boolean;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  price_brl: number | null;
  limits: BillingLimits;
  features: BillingFeatures;
  usage: Record<BillingLimitKey, number>;
  plans: BillingPlan[];
  checkout_available: boolean;
  contact: string;
}

/** Corpo do 402 (limite ou recurso fora do plano). */
export interface PlanLimitErrorBody {
  message: string;
  errors?: { plan?: string[] };
  plan_limit?: { limit: string; allowed: number | null; used: number | null };
}

export const API = {
  csrf: '/sanctum/csrf-cookie',
  login: '/auth/login',
  logout: '/auth/logout',
  register: '/auth/register',
  twoFactorChallenge: '/auth/two-factor-challenge',
  me: '/api/me',
  projects: '/api/projects',
  project: (id: string) => `/api/projects/${seg(id)}`,
  projectAccounts: (id: string) => `/api/projects/${seg(id)}/accounts`,
  projectMetricsQuery: (id: string) => `/api/projects/${seg(id)}/metrics/query`,
  projectAttention: (id: string) => `/api/projects/${seg(id)}/attention`,
  providers: '/api/providers',
  metricsCatalog: '/api/metrics/catalog',
  connections: '/api/connections',
  connectionSync: (id: string) => `/api/connections/${seg(id)}/sync`,
  customMetrics: '/api/custom-metrics',
  customMetric: (id: string) => `/api/custom-metrics/${seg(id)}`,
  customMetricsPreview: '/api/custom-metrics/preview',
  customMetricsTemplates: '/api/custom-metrics/templates',
  platformApps: '/api/platform-apps',
  platformApp: (vendor: AppVendor) => `/api/platform-apps/${seg(vendor)}`,
  platformAppVerify: (vendor: AppVendor) => `/api/platform-apps/${seg(vendor)}/verify`,
  team: '/api/team',
  teamInvitations: '/api/team/invitations',
  teamInvitation: (id: string) => `/api/team/invitations/${seg(id)}`,
  teamInvitationResend: (id: string) => `/api/team/invitations/${seg(id)}/resend`,
  teamMember: (userId: string) => `/api/team/members/${seg(userId)}`,
  invitation: (token: string) => `/api/invitations/${seg(token)}`,
  invitationAccept: (token: string) => `/api/invitations/${seg(token)}/accept`,
  reportTemplates: '/api/report-templates',
  reports: '/api/reports',
  report: (id: string) => `/api/reports/${seg(id)}`,
  reportRender: (id: string) => `/api/reports/${seg(id)}/render`,
  reportSnapshots: (id: string) => `/api/reports/${seg(id)}/snapshots`,
  projectSnapshots: (projectId: string) => `/api/projects/${seg(projectId)}/snapshots`,
  snapshot: (id: string) => `/api/snapshots/${seg(id)}`,
  snapshotPdf: (id: string) => `/api/snapshots/${seg(id)}/pdf`,
  snapshotLinks: (id: string) => `/api/snapshots/${seg(id)}/links`,
  shareLink: (id: string) => `/api/links/${seg(id)}`,
  publicReport: (token: string) => `/api/public/reports/${seg(token)}`,
  publicReportUnlock: (token: string) => `/api/public/reports/${seg(token)}/unlock`,
  overview: '/api/overview',
  projectContacts: (projectId: string) => `/api/projects/${seg(projectId)}/contacts`,
  contact: (id: string) => `/api/contacts/${seg(id)}`,
  contactConsents: (id: string) => `/api/contacts/${seg(id)}/consents`,
  automations: '/api/automations',
  automation: (id: string) => `/api/automations/${seg(id)}`,
  automationRunNow: (id: string) => `/api/automations/${seg(id)}/run`,
  automationsPreview: '/api/automations/preview',
  automationRuns: '/api/automation-runs',
  automationRun: (id: string) => `/api/automation-runs/${seg(id)}`,
  automationRunApprove: (id: string) => `/api/automation-runs/${seg(id)}/approve`,
  automationRunCancel: (id: string) => `/api/automation-runs/${seg(id)}/cancel`,
  whatsapp: '/api/whatsapp',
  whatsappVerify: '/api/whatsapp/verify',
  publicUnsubscribe: '/api/public/unsubscribe',
  reportLinks: (id: string) => `/api/reports/${seg(id)}/links`,
  goals: '/api/goals',
  goal: (id: string) => `/api/goals/${seg(id)}`,
  projectGoals: (projectId: string) => `/api/projects/${seg(projectId)}/goals`,
  projectTimeline: (projectId: string) => `/api/projects/${seg(projectId)}/timeline`,
  timelineEvent: (id: string) => `/api/timeline/${seg(id)}`,
  manualMetrics: '/api/manual-metrics',
  manualMetric: (id: string) => `/api/manual-metrics/${seg(id)}`,
  projectManualValues: (projectId: string) => `/api/projects/${seg(projectId)}/manual-values`,
  projectManualImport: (projectId: string) => `/api/projects/${seg(projectId)}/manual-values/import`,
  branding: '/api/branding',
  brandingLogo: '/api/branding/logo',
  brandingDomainVerify: '/api/branding/domain/verify',
  apiTokens: '/api/api-tokens',
  apiToken: (id: string) => `/api/api-tokens/${seg(id)}`,
  webhooks: '/api/webhooks',
  webhook: (id: string) => `/api/webhooks/${seg(id)}`,
  webhookRotate: (id: string) => `/api/webhooks/${seg(id)}/rotate`,
  webhookTest: (id: string) => `/api/webhooks/${seg(id)}/test`,
  webhookDeliveries: (id: string) => `/api/webhooks/${seg(id)}/deliveries`,
  projectHealth: (projectId: string) => `/api/projects/${seg(projectId)}/health`,
  actions: '/api/actions',
  action: (id: string) => `/api/actions/${seg(id)}`,
  projectActions: (projectId: string) => `/api/projects/${seg(projectId)}/actions`,
  staffMembers: '/api/staff-members',
  ai: '/api/ai',
  aiKey: '/api/ai/key',
  reportAiAnalysis: (reportId: string) => `/api/reports/${seg(reportId)}/ai/analysis`,
  projectAiAsk: (projectId: string) => `/api/projects/${seg(projectId)}/ai/ask`,
  imports: '/api/imports',
  importItem: (id: string) => `/api/imports/${seg(id)}`,
  importReportei: '/api/imports/reportei',
  inbox: '/api/whatsapp/conversations',
  /** Só os dígitos do telefone na URL (sem o "+"). */
  inboxThread: (phone: string) => `/api/whatsapp/conversations/${seg(phone.replace(/\D/g, ''))}`,
  inboxReply: (phone: string) => `/api/whatsapp/conversations/${seg(phone.replace(/\D/g, ''))}/reply`,
  inboxSimulate: '/api/whatsapp/simulate-inbound',
  // Minha conta (Fortify): as que alteram segurança exigem senha confirmada (423 sem ela).
  confirmPassword: '/auth/user/confirm-password',
  confirmedPasswordStatus: '/auth/user/confirmed-password-status',
  profileInformation: '/auth/user/profile-information',
  password: '/auth/user/password',
  twoFactor: '/auth/user/two-factor-authentication',
  twoFactorConfirm: '/auth/user/confirmed-two-factor-authentication',
  twoFactorQrCode: '/auth/user/two-factor-qr-code',
  twoFactorSecretKey: '/auth/user/two-factor-secret-key',
  twoFactorRecoveryCodes: '/auth/user/two-factor-recovery-codes',
  mePasskeys: '/api/me/passkeys',
  passkeyRegistrationOptions: '/auth/user/passkeys/options',
  passkeys: '/auth/user/passkeys',
  passkey: (id: number | string) => `/auth/user/passkeys/${seg(String(id))}`,
  passkeyLoginOptions: '/auth/passkeys/login/options',
  passkeyLogin: '/auth/passkeys/login',
  // Sync para Google Sheets
  syncDestinations: '/api/sync/destinations',
  syncDestination: (id: string) => `/api/sync/destinations/${seg(id)}`,
  sheetSyncs: '/api/sheet-syncs',
  sheetSync: (id: string) => `/api/sheet-syncs/${seg(id)}`,
  sheetSyncRun: (id: string) => `/api/sheet-syncs/${seg(id)}/run`,
  // Publishing
  publishingNetworks: '/api/publishing/networks',
  media: '/api/media',
  mediaItem: (id: string) => `/api/media/${seg(id)}`,
  posts: '/api/posts',
  post: (id: string) => `/api/posts/${seg(id)}`,
  postApproval: (id: string) => `/api/posts/${seg(id)}/approval`,
  postSchedule: (id: string) => `/api/posts/${seg(id)}/schedule`,
  postUnschedule: (id: string) => `/api/posts/${seg(id)}/unschedule`,
  postPublish: (id: string) => `/api/posts/${seg(id)}/publish`,
  postCancel: (id: string) => `/api/posts/${seg(id)}/cancel`,
  publicApproval: (token: string) => `/api/public/approvals/${seg(token)}`,
  // Delta Connect: sessão hospedada (pública)
  publicConnect: (token: string) => `/api/public/connect/${seg(token)}`,
  // Studio
  presentations: '/api/presentations',
  presentation: (id: string) => `/api/presentations/${seg(id)}`,
  presentationVersion: (id: string, n: number) => `/api/presentations/${seg(id)}/versions/${n}`,
  presentationRevise: (id: string) => `/api/presentations/${seg(id)}/revise`,
  presentationRestore: (id: string) => `/api/presentations/${seg(id)}/restore`,
  presentationRetry: (id: string) => `/api/presentations/${seg(id)}/retry`,
  presentationPdf: (id: string) => `/api/presentations/${seg(id)}/pdf`,
  // Gestão de anúncios
  adsAccounts: '/api/ads/accounts',
  adsCampaigns: (accountId: string) => `/api/ads/accounts/${seg(accountId)}/campaigns`,
  adsChange: (accountId: string) => `/api/ads/accounts/${seg(accountId)}/changes`,
  adsChanges: '/api/ads/changes',
  // Plano
  billing: '/api/billing',
} as const;

export const TENANT_HEADER = 'X-Tenant-Id';
