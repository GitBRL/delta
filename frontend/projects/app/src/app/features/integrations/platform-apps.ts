import { StatusLevel } from 'design-system';
import { AppVendor, PlatformApp, PlatformAppStatus, SavePlatformAppBody } from '../../core/api/api.types';

/** Selo de cada estado do app. `level` nulo = selo neutro (nada configurado). */
export const APP_STATUS: Readonly<Record<PlatformAppStatus, { level: StatusLevel | null; label: string }>> = {
  verified: { level: 'healthy', label: 'Verificado' },
  unverified: { level: 'attention', label: 'Não verificado' },
  invalid: { level: 'critical', label: 'Credenciais recusadas' },
  server: { level: 'opportunity', label: 'Usando credenciais do servidor' },
  missing: { level: null, label: 'Não configurado' },
};

/** Rascunho do formulário. O segredo e o token só existem aqui até o envio. */
export interface PlatformAppDraft {
  client_id: string;
  client_secret: string;
  developer_token: string;
}

export const EMPTY_APP_DRAFT: PlatformAppDraft = { client_id: '', client_secret: '', developer_token: '' };

/** Rascunho inicial: só o ID (público); segredos começam vazios ("em branco = manter"). */
export function appDraftFrom(app: PlatformApp): PlatformAppDraft {
  return { ...EMPTY_APP_DRAFT, client_id: app.source === 'agency' ? (app.client_id ?? '') : '' };
}

/** A agência já tem segredo salvo? (então o campo em branco mantém o atual) */
export function hasStoredSecret(app: PlatformApp): boolean {
  return app.source === 'agency' && !!app.client_secret_hint;
}

/** Corpo do PUT: segredo e token em branco não vão (o backend mantém os atuais). */
export function buildAppBody(app: PlatformApp, draft: PlatformAppDraft): SavePlatformAppBody {
  const body: SavePlatformAppBody = { client_id: draft.client_id.trim() };
  const secret = draft.client_secret.trim();
  if (secret) body.client_secret = secret;
  const token = draft.developer_token.trim();
  if (app.requires_developer_token && token) body.developer_token = token;
  return body;
}

/** Validação mínima antes de enviar (o backend é quem decide o formato). */
export function validateAppDraft(app: PlatformApp, draft: PlatformAppDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.client_id.trim()) {
    errors['client_id'] = `Informe o ${ID_LABEL[app.vendor]}.`;
  }
  if (!hasStoredSecret(app) && !draft.client_secret.trim()) {
    errors['client_secret'] = `Informe ${SECRET_NOUN[app.vendor]}.`;
  }
  return errors;
}

/** "Meta Ads, Facebook e Instagram" */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/** Nomes das plataformas ainda sem login real (o backend manda as chaves; nomes desconhecidos passam como vieram). */
export function missingPlatformNames(app: PlatformApp): string[] {
  const names = new Map(app.platforms.map((p) => [p.key, p.name]));
  return app.missing_platforms.map((key) => names.get(key) ?? key);
}

export const ID_LABEL: Readonly<Record<AppVendor, string>> = {
  meta: 'ID do app',
  google: 'ID do cliente',
  tiktok: 'App ID',
  linkedin: 'Client ID',
};

/** Nome do segredo como aparece no painel de cada plataforma. */
export const SECRET_LABEL: Readonly<Record<AppVendor, string>> = {
  meta: 'Chave secreta',
  google: 'Chave secreta',
  tiktok: 'Secret',
  linkedin: 'Client Secret',
};

/** O segredo com artigo, para mensagens ("Informe a chave secreta.", "Cole o Secret"). */
export const SECRET_NOUN: Readonly<Record<AppVendor, string>> = {
  meta: 'a chave secreta',
  google: 'a chave secreta',
  tiktok: 'o Secret',
  linkedin: 'o Client Secret',
};

export const ID_PLACEHOLDER: Readonly<Record<AppVendor, string>> = {
  meta: 'Ex.: 1234567890123456',
  google: 'Ex.: 1234-abc.apps.googleusercontent.com',
  tiktok: 'Ex.: 7300000000000000001',
  linkedin: 'Ex.: 86abcdefgh1234',
};

/** "do app da Meta" etc. (para "Como criar o app …", "App … removido"). */
export const VENDOR_OF: Readonly<Record<AppVendor, string>> = {
  meta: 'da Meta',
  google: 'do Google',
  tiktok: 'do TikTok',
  linkedin: 'do LinkedIn',
};

/** Ícone de cada vendor (reaproveita o do canal principal). */
export const VENDOR_ICON: Readonly<Record<AppVendor, string>> = {
  meta: 'meta_ads',
  google: 'google_ads',
  tiktok: 'tiktok_ads',
  linkedin: 'linkedin_ads',
};

/**
 * Plataformas que não deixam conferir só o app (o TikTok exige autorizar um anunciante):
 * "não verificado" é o normal até a primeira conexão, sem tom de alerta.
 */
export const VERIFIED_ON_FIRST_CONNECTION: ReadonlySet<AppVendor> = new Set<AppVendor>(['tiktok']);

/** Selo do card: no TikTok, "não verificado" vira "Confere na 1ª conexão" (neutro). */
export function appStatusMeta(app: PlatformApp): { level: StatusLevel | null; label: string } {
  if (app.status === 'unverified' && VERIFIED_ON_FIRST_CONNECTION.has(app.vendor)) {
    return { level: 'opportunity', label: 'Confere na 1ª conexão' };
  }
  return APP_STATUS[app.status];
}

/** Passo a passo para criar o app em cada plataforma (texto curto, em ordem). */
export const SETUP_GUIDE: Readonly<Record<AppVendor, { console: string; steps: readonly string[]; note: string }>> = {
  meta: {
    console: 'Abrir o Meta for Developers',
    steps: [
      'Crie um app do tipo “Empresa” no Meta for Developers.',
      'Adicione o produto “Login do Facebook”.',
      'Em Login do Facebook › Configurações, cole os endereços abaixo em “URIs de redirecionamento do OAuth válidos”.',
      'Em Configurações do app › Básico, copie o “ID do app” e a “Chave secreta do app” e cole aqui.',
    ],
    note: 'Enquanto o app estiver em modo de desenvolvimento, só administradores e testadores do app conseguem autorizar. Para clientes em geral, as permissões passam pela análise da Meta.',
  },
  google: {
    console: 'Abrir o Google Cloud Console',
    steps: [
      'No Google Cloud Console, em APIs e serviços › Credenciais, crie um “ID do cliente OAuth” do tipo “Aplicativo da Web”.',
      'Cole os endereços abaixo em “URIs de redirecionamento autorizados”.',
      'Em APIs e serviços › Biblioteca, ative a “Google Analytics Admin API” e a “Google Ads API”.',
      'Copie o ID do cliente e a chave secreta e cole aqui.',
      'Só para o Google Ads: copie o developer token na Central de API da sua conta de administrador do Google Ads.',
    ],
    note: 'Com a tela de consentimento em modo “teste”, só os usuários de teste cadastrados conseguem autorizar.',
  },
  tiktok: {
    console: 'Abrir o TikTok for Business Developers',
    steps: [
      'No portal TikTok for Business Developers, em My Apps, crie um app da Marketing API.',
      'Cole o endereço abaixo em “Advertiser redirect URL”.',
      'Peça o escopo de leitura de relatórios e de informações do anunciante.',
      'Depois da aprovação, copie o “App ID” e o “Secret” e cole aqui.',
    ],
    note: 'O TikTok não permite conferir o app sem autorizar um anunciante: ele é conferido na primeira conexão. Enquanto o app não for aprovado, só anunciantes de teste conseguem autorizar.',
  },
  linkedin: {
    console: 'Abrir o LinkedIn Developers',
    steps: [
      'No LinkedIn Developers, crie um app ligado à página da sua agência.',
      'Em Products, peça acesso à “Advertising API” (Marketing).',
      'Na aba Auth, cole o endereço abaixo em “Authorized redirect URLs for your app”.',
      'Ainda na aba Auth, copie o “Client ID” e o “Client Secret” e cole aqui.',
    ],
    note: 'Sem o acesso à Advertising API aprovado, o LinkedIn recusa os escopos de anúncios (r_ads e r_ads_reporting) na hora de conectar.',
  },
};
