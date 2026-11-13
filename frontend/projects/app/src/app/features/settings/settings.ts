import { ApiToken, Branding, BrandingBody, PublicBranding, ReportData, WebhookEndpoint } from '../../core/api/api.types';
import { FieldErrors } from '../../core/forms/server-errors';

/* ---------- Marca ---------- */

export const HEX = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_BRAND_COLOR = '#0a84ff';
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export interface BrandingDraft {
  display_name: string;
  primary_color: string;
  hide_delta_badge: boolean;
  email_reply_to: string;
  custom_domain: string;
}

export function brandingDraftFrom(b: Branding): BrandingDraft {
  return {
    display_name: b.display_name ?? '',
    primary_color: b.primary_color ?? '',
    hide_delta_badge: b.hide_delta_badge,
    email_reply_to: b.email_reply_to ?? '',
    custom_domain: b.custom_domain ?? '',
  };
}

export function validateBranding(d: BrandingDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (d.primary_color && !HEX.test(d.primary_color)) errors['primary_color'] = 'Use uma cor no formato #RRGGBB.';
  if (d.email_reply_to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email_reply_to)) errors['email_reply_to'] = 'E-mail inválido.';
  if (d.custom_domain && /^https?:\/\//i.test(d.custom_domain)) errors['custom_domain'] = 'Informe só o domínio, sem http://.';
  return errors;
}

export function brandingBody(d: BrandingDraft): BrandingBody {
  return {
    display_name: d.display_name.trim() || null,
    primary_color: d.primary_color.trim() || null,
    hide_delta_badge: d.hide_delta_badge,
    email_reply_to: d.email_reply_to.trim() || null,
    custom_domain: d.custom_domain.trim().toLowerCase() || null,
  };
}

/** Marca como ficaria com o rascunho atual (prévia ao vivo). */
export function previewBrand(saved: Branding, draft: BrandingDraft, tenantName: string, logo: string | null): PublicBranding {
  return {
    name: draft.display_name.trim() || tenantName || saved.name,
    color: HEX.test(draft.primary_color) ? draft.primary_color.toLowerCase() : DEFAULT_BRAND_COLOR,
    logo_url: logo,
    hide_delta_badge: draft.hide_delta_badge,
  };
}

/** Relatório de exemplo, só com a capa, para a prévia da marca. */
export function previewReport(agency: string): ReportData {
  return {
    version: 1,
    title: 'Relatório mensal',
    agency,
    project: { id: 'preview', name: 'Padaria Aurora', niche: null },
    period: { start: '2026-10-01', end: '2026-10-31', label: '01/10/2026 – 31/10/2026' },
    compare: 'previous_period',
    comparison: { start: '2026-09-01', end: '2026-09-30' },
    generated_at: '2026-11-01T09:00:00-03:00',
    sections: [],
  };
}

/** Problema do arquivo de logo antes de enviar (ou null). */
export function logoProblem(file: { type: string; size: number }): string | null {
  if (file.type === 'image/svg+xml') return 'SVG não é aceito por segurança. Use PNG, JPG ou WebP.';
  if (!LOGO_TYPES.includes(file.type)) return 'Use PNG, JPG ou WebP.';
  if (file.size > LOGO_MAX_BYTES) return 'O logo pode ter no máximo 2 MB.';
  return null;
}

/* ---------- API e webhooks ---------- */

export const TOKEN_EXPIRY: readonly { value: number | null; label: string }[] = [
  { value: null, label: 'Sem validade' },
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
  { value: 180, label: '180 dias' },
  { value: 365, label: '1 ano' },
];

export function tokenState(t: ApiToken, now: Date = new Date()): { label: string; tone: 'ok' | 'off' } {
  if (t.revoked_at) return { label: 'Revogado', tone: 'off' };
  if (t.expires_at && new Date(t.expires_at) <= now) return { label: 'Expirado', tone: 'off' };
  return { label: 'Ativo', tone: 'ok' };
}

export function webhookState(w: WebhookEndpoint): { label: string; tone: 'ok' | 'off' | 'warn' } {
  if (w.disabled_at) return { label: 'Desativado após falhas', tone: 'warn' };
  if (!w.active) return { label: 'Pausado', tone: 'off' };
  return { label: 'Ativo', tone: 'ok' };
}

export function eventsText(events: readonly string[], labels: Readonly<Record<string, string>>): string {
  if (events.includes('*')) return 'Todos os eventos';
  return events.map((e) => labels[e] ?? e).join(' · ');
}

export function apiBase(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/v1`;
}

export function curlExample(base: string): string {
  return `curl ${base}/projects \\\n  -H "Authorization: Bearer dlt_SEU_TOKEN"`;
}

export const API_ENDPOINTS: readonly { method: string; path: string; scope: string; text: string }[] = [
  { method: 'GET', path: '/projects', scope: 'projects:read', text: 'Projetos da agência' },
  { method: 'GET', path: '/metrics', scope: 'metrics:read', text: 'Métricas disponíveis (catálogo, personalizadas e manuais)' },
  { method: 'POST', path: '/projects/{id}/metrics/query', scope: 'metrics:read', text: 'Consulta de métricas por período' },
  { method: 'GET', path: '/reports', scope: 'reports:read', text: 'Relatórios' },
  { method: 'POST', path: '/reports/{id}/snapshots', scope: 'reports:write', text: 'Publicar uma versão' },
  { method: 'GET', path: '/snapshots/{id}/pdf', scope: 'reports:read', text: 'PDF de uma versão publicada' },
  { method: 'GET · POST · DELETE', path: '/webhooks', scope: 'webhooks:manage', text: 'Gerenciar webhooks' },
];

/* ---------- Servidor MCP e CLI (ADR 0026) ---------- */

/** Endereço do servidor MCP: a mesma origem da API (POST /mcp). */
export function mcpUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/mcp`;
}

/** Configuração para colar no cliente MCP (Claude, Cursor…), com o token no cabeçalho. */
export function mcpConfig(url: string): string {
  return JSON.stringify(
    { mcpServers: { delta: { type: 'http', url, headers: { Authorization: 'Bearer dlt_SEU_TOKEN' } } } },
    null,
    2,
  );
}

export const MCP_TOOLS: readonly { name: string; scope: string; text: string }[] = [
  { name: 'list_projects', scope: 'projects:read', text: 'Projetos (clientes) da agência' },
  { name: 'get_project', scope: 'projects:read', text: 'Dados de negócio e contas conectadas' },
  { name: 'list_goals', scope: 'projects:read', text: 'Metas com progresso e projeção' },
  { name: 'list_timeline_events', scope: 'projects:read', text: 'Linha do tempo do projeto' },
  { name: 'list_metrics', scope: 'metrics:read', text: 'Catálogo de métricas' },
  { name: 'get_metrics_data', scope: 'metrics:read', text: 'Valores do período, com comparação' },
  { name: 'get_performance_summary', scope: 'metrics:read', text: 'Saúde da conta e sinais de atenção' },
  { name: 'list_reports', scope: 'reports:read', text: 'Relatórios e versões publicadas' },
  { name: 'get_report_snapshot', scope: 'reports:read', text: 'Conteúdo de uma versão publicada' },
];

export const MCP_PROMPTS: readonly { name: string; text: string }[] = [
  { name: 'monthly-review', text: 'Análise do mês de um cliente' },
  { name: 'campaign-analysis', text: 'Diagnóstico da mídia paga' },
];

/** Comandos da CLI delta, que fala com o mesmo servidor MCP. */
export function cliExample(origin: string): string {
  return [
    `node cli/bin/delta.mjs login --url ${origin.replace(/\/$/, '')} --token -`,
    'node cli/bin/delta.mjs projects',
    'node cli/bin/delta.mjs summary <projeto>',
  ].join('\n');
}

/* ---------- Delta Connect (ADR 0032) ---------- */

/** Base do Connect: a mesma origem da API. */
export function connectBase(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/connect/v1`;
}

/** "merchant" = token da agência com o escopo connect; "customer" = mais o X-Customer-Token. */
export const CONNECT_ENDPOINTS: readonly { method: string; path: string; who: 'merchant' | 'customer'; text: string }[] = [
  { method: 'GET · POST', path: '/customers', who: 'merchant', text: 'Listar e criar customers (o token dct_ vem só na criação)' },
  { method: 'GET · PATCH · DELETE', path: '/customers/{id}', who: 'merchant', text: 'Detalhe com integrações, atualizar e revogar' },
  { method: 'POST', path: '/customers/{id}/token', who: 'merchant', text: 'Novo token do customer (o anterior deixa de valer)' },
  { method: 'GET', path: '/integrations', who: 'merchant', text: 'Plataformas e modos disponíveis' },
  { method: 'POST', path: '/customer-integrations/session', who: 'merchant', text: 'Link de 30 min para o cliente conectar as contas' },
  { method: 'GET', path: '/customer', who: 'customer', text: 'Dados e integrações do customer' },
  { method: 'GET', path: '/metrics', who: 'customer', text: 'Métricas disponíveis (reference_key)' },
  { method: 'POST', path: '/metrics/get-data', who: 'customer', text: 'Consulta na hora' },
  { method: 'POST', path: '/metrics/get-data-async', who: 'customer', text: 'Consulta assíncrona: o resultado chega por webhook' },
];

export const CONNECT_EVENTS: readonly { name: string; text: string }[] = [
  { name: 'connect.metrics_ready', text: 'Resultado da consulta assíncrona (com o request_id)' },
  { name: 'customer_integration.connected', text: 'O cliente conectou uma conta pela página hospedada' },
];

/** Criar um customer e gerar o link da sessão hospedada. */
export function connectCurlExample(base: string): string {
  return [
    `curl -X POST ${base}/customers \\`,
    '  -H "Authorization: Bearer dlt_TOKEN_COM_CONNECT" -H "Content-Type: application/json" \\',
    `  -d '{"name": "Loja Boreal", "external_id": "cli-42"}'`,
    '# guarde o "customer_token" (dct_…): ele não aparece de novo',
    '',
    `curl -X POST ${base}/customer-integrations/session \\`,
    '  -H "Authorization: Bearer dlt_TOKEN_COM_CONNECT" -H "Content-Type: application/json" \\',
    `  -d '{"customer_id": "ID_DO_CUSTOMER", "platforms": ["meta_ads", "ga4"], "return_url": "https://seu-saas.com/voltar"}'`,
    '# envie o "url" ao seu cliente: ele conecta as contas sem conta no Delta',
  ].join('\n');
}

/** Servidor de desenvolvimento do front (ng serve): a API fica em outra porta. */
export function isDevFrontOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1):4\d{3}$/.test(origin.replace(/\/$/, ''));
}

export const SIGNATURE_PHP = `$parts = [];
foreach (explode(',', $_SERVER['HTTP_X_DELTA_SIGNATURE']) as $part) {
    [$k, $v] = explode('=', $part, 2);
    $parts[$k] = $v;
}
$body = file_get_contents('php://input');
$expected = hash_hmac('sha256', $parts['t'].'.'.$body, $secret);
$valid = hash_equals($expected, $parts['v1']) && abs(time() - (int) $parts['t']) < 300;`;

export const SIGNATURE_NODE = `const parts = Object.fromEntries(req.headers['x-delta-signature'].split(',').map((p) => p.split('=')));
const expected = crypto.createHmac('sha256', secret).update(\`\${parts.t}.\${rawBody}\`).digest('hex');
const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))
  && Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;`;

/** Copia texto para a área de transferência. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
