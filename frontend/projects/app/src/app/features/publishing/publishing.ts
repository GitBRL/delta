import { HttpErrorResponse } from '@angular/common/http';
import {
  MediaAsset,
  Post,
  PostApproval,
  PostBody,
  PostStatus,
  PostTargetBody,
  PostTargetStatus,
  PublishNetwork,
  PublishNetworkSpec,
  ValidationErrorBody,
} from '../../core/api/api.types';
import { FieldErrors } from '../../core/forms/server-errors';

/* ---------- Limites do backend (ADR 0028) ---------- */

export const POST_LIMITS = { titleMax: 120, mediaMax: 10, targetsMax: 6, hashtagsInstagram: 30, uploadMaxBytes: 100 * 1024 * 1024 } as const;
export const ACCEPTED_UPLOAD = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';

/* ---------- Status ---------- */

export type StatusTone = 'neutral' | 'accent' | 'attention' | 'healthy' | 'critical' | 'muted';

export const STATUS_TEXT: Readonly<Record<PostStatus, string>> = {
  draft: 'Rascunho',
  in_review: 'Aguardando aprovação',
  changes_requested: 'Ajustes pedidos',
  approved: 'Aprovado',
  scheduled: 'Agendado',
  publishing: 'Publicando',
  published: 'Publicado',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

const STATUS_TONE: Readonly<Record<PostStatus, StatusTone>> = {
  draft: 'neutral',
  in_review: 'attention',
  changes_requested: 'attention',
  approved: 'healthy',
  scheduled: 'accent',
  publishing: 'accent',
  published: 'healthy',
  failed: 'critical',
  cancelled: 'muted',
};

export function statusTone(status: PostStatus): StatusTone {
  return STATUS_TONE[status];
}

/** Filtros de status do calendário (na ordem do ciclo de vida). */
export const STATUS_FILTERS: readonly PostStatus[] = [
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
];

export const TARGET_STATUS_TEXT: Readonly<Record<PostTargetStatus, string>> = {
  pending: 'Pendente',
  publishing: 'Publicando',
  published: 'Publicado',
  failed: 'Falhou',
};

export const NETWORK_TEXT: Readonly<Record<PublishNetwork, string>> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
};

/** Rótulo curto do formato ("Feed", "Reels"…), sem a regra entre parênteses. */
export const FORMAT_TEXT: Readonly<Record<string, string>> = {
  feed: 'Feed',
  carousel: 'Carrossel',
  reels: 'Reels',
  story: 'Story',
  short: 'Shorts',
};

export function formatText(format: string): string {
  return FORMAT_TEXT[format] ?? format;
}

/** O "canal" do ícone genérico (app-provider-icon) é o mesmo nome da rede. */
export function networkIcon(network: PublishNetwork): string {
  return network;
}

/* ---------- Legenda ---------- */

const HASHTAG = /(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu;

export function hashtagCount(caption: string): number {
  return caption.match(HASHTAG)?.length ?? 0;
}

/** Caracteres como o backend conta (mb_strlen: pontos de código, não unidades UTF-16). */
export function captionLength(caption: string): number {
  return [...caption].length;
}

export interface CaptionInfo {
  length: number;
  /** Limite da rede mais restritiva escolhida (null = nenhuma rede ainda). */
  max: number | null;
  /** Rede que define o limite. */
  limitedBy: string | null;
  over: boolean;
  hashtags: number;
  /** Só quando o Instagram está entre os destinos. */
  hashtagMax: number | null;
  hashtagsOver: boolean;
}

export function captionInfo(caption: string, specs: readonly PublishNetworkSpec[], networks: readonly PublishNetwork[]): CaptionInfo {
  const chosen = specs.filter((s) => networks.includes(s.key));
  const strictest = chosen.reduce<PublishNetworkSpec | null>((min, s) => (min === null || s.caption_max < min.caption_max ? s : min), null);
  const length = captionLength(caption);
  const hashtags = hashtagCount(caption);
  const hashtagMax = networks.includes('instagram') ? POST_LIMITS.hashtagsInstagram : null;
  return {
    length,
    max: strictest?.caption_max ?? null,
    limitedBy: strictest?.label ?? null,
    over: strictest !== null && length > strictest.caption_max,
    hashtags,
    hashtagMax,
    hashtagsOver: hashtagMax !== null && hashtags > hashtagMax,
  };
}

/* ---------- Rascunho ---------- */

export interface PostDraft {
  /** null = post novo. */
  id: string | null;
  project_id: string;
  title: string;
  caption: string;
  media: MediaAsset[];
  requires_approval: boolean;
  targets: PostTargetBody[];
}

export function emptyPostDraft(projectId = ''): PostDraft {
  return { id: null, project_id: projectId, title: '', caption: '', media: [], requires_approval: true, targets: [] };
}

export function postDraftFrom(post: Post): PostDraft {
  return {
    id: post.id,
    project_id: post.project.id,
    title: post.title ?? '',
    caption: post.caption,
    media: [...post.media],
    requires_approval: post.requires_approval,
    targets: post.targets.map((t) => ({ network: t.network, format: t.format, account_id: t.account?.id ?? null })),
  };
}

/** Corpo do POST (com o projeto) ou do PATCH (sem ele). */
export function postBody(d: PostDraft): PostBody {
  const common: PostBody = {
    title: d.title.trim() === '' ? null : d.title.trim(),
    caption: d.caption,
    media: d.media.map((m) => m.id),
    requires_approval: d.requires_approval,
    targets: d.targets,
  };
  return d.id === null ? { project_id: d.project_id, ...common } : common;
}

/** O rascunho mudou em relação ao que está salvo? */
export function draftChanged(a: PostDraft, b: PostDraft): boolean {
  return JSON.stringify(postBody(a)) !== JSON.stringify(postBody(b)) || a.project_id !== b.project_id;
}

export function validatePostDraft(d: PostDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (d.id === null && !d.project_id) errors['project_id'] = 'Escolha o projeto.';
  if (d.title.trim().length > POST_LIMITS.titleMax) errors['title'] = `Use no máximo ${POST_LIMITS.titleMax} caracteres.`;
  if (d.media.length > POST_LIMITS.mediaMax) errors['media'] = `Use no máximo ${POST_LIMITS.mediaMax} mídias.`;
  if (d.targets.length > POST_LIMITS.targetsMax) errors['targets'] = `Escolha no máximo ${POST_LIMITS.targetsMax} destinos.`;
  return errors;
}

/** Move um item da lista (reordenação por botões, acessível no teclado e no celular). */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const copy = [...list];
  [copy[index], copy[to]] = [copy[to], copy[index]];
  return copy;
}

/* ---------- Ações por status ---------- */

export interface PostActions {
  edit: boolean;
  requestApproval: boolean;
  schedule: boolean;
  unschedule: boolean;
  publishNow: boolean;
  cancel: boolean;
  remove: boolean;
}

const EDITABLE: readonly PostStatus[] = ['draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'failed'];

/** O que a equipe pode fazer com o post agora (o cliente só lê). Espelha o PublishingService. */
export function postActions(post: Pick<Post, 'status' | 'requires_approval' | 'scheduled_at' | 'targets'>): PostActions {
  const s = post.status;
  const noApproval = !post.requires_approval;
  const anyPublished = post.targets.some((t) => t.status === 'published');
  return {
    edit: EDITABLE.includes(s),
    requestApproval: s === 'draft' || s === 'changes_requested' || s === 'in_review',
    schedule:
      s === 'approved' || s === 'scheduled' || s === 'failed' || s === 'in_review' || (noApproval && (s === 'draft' || s === 'changes_requested')),
    unschedule: s === 'scheduled' || (s === 'in_review' && post.scheduled_at !== null),
    publishNow: s === 'approved' || s === 'scheduled' || s === 'failed' || (noApproval && (s === 'draft' || s === 'changes_requested')),
    cancel: s !== 'publishing' && s !== 'published' && s !== 'cancelled',
    remove: s !== 'publishing' && s !== 'published' && !anyPublished,
  };
}

/** Explica o que acontece ao agendar, conforme o status. */
export function scheduleHint(post: Pick<Post, 'status' | 'requires_approval'>): string | null {
  if (post.status === 'in_review') return 'O post está com o cliente: a data fica guardada e ele é agendado sozinho quando o cliente aprovar.';
  if (post.requires_approval && (post.status === 'draft' || post.status === 'changes_requested')) {
    return 'Peça a aprovação do cliente antes de agendar (ou desligue a aprovação deste post).';
  }
  return null;
}

/** Frase sobre os avisos do pedido de aprovação. */
export function notifiedText(notified: PostApproval['notified']): string {
  const parts: string[] = [];
  if (notified.email > 0) parts.push(`${notified.email} por e-mail`);
  if (notified.whatsapp > 0) parts.push(`${notified.whatsapp} por WhatsApp`);
  return parts.length === 0 ? 'Nenhum contato foi avisado automaticamente.' : `Avisos enviados: ${parts.join(' e ')}.`;
}

export const WHATSAPP_WINDOW_HINT =
  'O WhatsApp só sai em texto livre para quem falou com a agência nas últimas 24 horas. Para os demais, copie o link e envie você mesmo.';

/* ---------- Datas ---------- */

/** Data que o calendário usa: agendada, publicada ou de criação. */
export function postDate(post: Pick<Post, 'scheduled_at' | 'published_at' | 'created_at'>): string {
  return post.scheduled_at ?? post.published_at ?? post.created_at;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** AAAA-MM-DD no fuso do navegador. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Valor para <input type="datetime-local"> (fuso do navegador). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Do <input type="datetime-local"> para ISO (com o fuso). null se vazio ou inválido. */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const LONG_DATE_TIME = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const MONTH_TITLE = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const DAY_TITLE = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const SHORT_DAY = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });

export function formatDateTime(iso: string | null): string {
  return iso ? DATE_TIME.format(new Date(iso)) : '—';
}

export function formatLongDateTime(iso: string | null): string {
  return iso ? LONG_DATE_TIME.format(new Date(iso)) : '—';
}

export function formatTime(iso: string): string {
  return TIME.format(new Date(iso));
}

export function formatDayTitle(date: Date): string {
  return DAY_TITLE.format(date);
}

export function formatShortDay(date: Date): string {
  return SHORT_DAY.format(date);
}

/* ---------- Calendário ---------- */

export type CalendarView = 'month' | 'week';

export const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Semanas do mês (domingo a sábado), incluindo os dias das pontas dos meses vizinhos. */
export function monthGrid(anchor: Date): Date[][] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  let day = addDays(first, -first.getDay());
  const end = addDays(last, 6 - last.getDay());
  const weeks: Date[][] = [];
  while (day <= end) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Os 7 dias da semana do dia âncora (domingo a sábado). */
export function weekDays(anchor: Date): Date[] {
  const start = addDays(startOfDay(anchor), -anchor.getDay());
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Intervalo da busca no backend (AAAA-MM-DD, inclusivo) para a visão atual. */
export function calendarRange(view: CalendarView, anchor: Date): { from: string; to: string } {
  const days = view === 'month' ? monthGrid(anchor).flat() : weekDays(anchor);
  return { from: dayKey(days[0]), to: dayKey(days[days.length - 1]) };
}

export function shiftAnchor(view: CalendarView, anchor: Date, delta: number): Date {
  return view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1) : addDays(startOfDay(anchor), 7 * delta);
}

export function calendarTitle(view: CalendarView, anchor: Date): string {
  if (view === 'month') {
    const title = MONTH_TITLE.format(anchor);
    return title.charAt(0).toUpperCase() + title.slice(1);
  }
  const days = weekDays(anchor);
  return `${formatShortDay(days[0])} – ${formatShortDay(days[6])}`;
}

/** Posts por dia (fuso do navegador), na ordem do horário. */
export function groupByDay(posts: readonly Post[]): Map<string, Post[]> {
  const map = new Map<string, Post[]>();
  const sorted = [...posts].sort((a, b) => new Date(postDate(a)).getTime() - new Date(postDate(b)).getTime());
  for (const post of sorted) {
    const key = dayKey(new Date(postDate(post)));
    const list = map.get(key) ?? [];
    list.push(post);
    map.set(key, list);
  }
  return map;
}

export interface PostCounters {
  review: number;
  upcoming: number;
  failed: number;
}

/** Contadores do topo: aguardando aprovação, agendados nos próximos 7 dias e com falha. */
export function postCounters(posts: readonly Post[], now: Date = new Date()): PostCounters {
  const limit = now.getTime() + 7 * 24 * 3600 * 1000;
  return {
    review: posts.filter((p) => p.status === 'in_review').length,
    upcoming: posts.filter((p) => {
      if (p.status !== 'scheduled' || !p.scheduled_at) return false;
      const at = new Date(p.scheduled_at).getTime();
      return at >= now.getTime() && at <= limit;
    }).length,
    failed: posts.filter((p) => p.status === 'failed').length,
  };
}

/* ---------- Prévia e mídia ---------- */

export type PreviewShape = 'square' | 'vertical';

export function previewShape(format: string): PreviewShape {
  return format === 'reels' || format === 'story' || format === 'short' ? 'vertical' : 'square';
}

const SIZE = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export function mediaSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${SIZE.format(bytes / (1024 * 1024))} MB`;
  return `${SIZE.format(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** Confere o arquivo antes de enviar (o backend confere de novo pelo conteúdo). */
export function uploadProblem(file: Pick<File, 'type' | 'size' | 'name'>): string | null {
  if (!ACCEPTED_UPLOAD.split(',').includes(file.type)) return `${file.name}: use imagem JPG, PNG ou WebP, ou vídeo MP4 ou MOV.`;
  if (file.size > POST_LIMITS.uploadMaxBytes) return `${file.name}: o arquivo pode ter no máximo 100 MB.`;
  return null;
}

/* ---------- Erros ---------- */

/** Todas as mensagens de um campo num 422 (ex.: `errors.post` traz a lista de pendências). */
export function fieldMessages(error: unknown, field: string): string[] {
  if (!(error instanceof HttpErrorResponse) || error.status !== 422) return [];
  const body = error.error as Partial<ValidationErrorBody> | null;
  const messages = body?.errors?.[field];
  return Array.isArray(messages) ? messages.map(String) : [];
}
