import { httpResource } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { API, InboxConversation, InboxListResponse, InboxMessage, TENANT_HEADER } from '../../core/api/api.types';
import { TenantService } from '../../core/tenant/tenant.service';

/** A lista é atualizada a cada 15 s com a tela aberta. */
export const INBOX_POLL_MS = 15_000;
/** O contador do menu é atualizado a cada minuto. */
export const INBOX_BADGE_POLL_MS = 60_000;

/**
 * Conversas do WhatsApp da agência (equipe). Uma busca compartilhada entre a tela de conversas e o
 * contador de não lidas do menu.
 */
@Injectable({ providedIn: 'root' })
export class InboxStore {
  private readonly tenant = inject(TenantService);

  readonly resource = httpResource<InboxListResponse>(() => {
    const current = this.tenant.current();
    return current && current.role !== 'client' ? { url: API.inbox, headers: { [TENANT_HEADER]: current.id } } : undefined;
  });

  readonly conversations = computed<InboxConversation[]>(() => (this.resource.hasValue() ? this.resource.value().data : []));
  readonly unread = computed(() => this.conversations().reduce((n, c) => n + c.unread, 0));
  /** Modo do WhatsApp da agência, informado a toda a equipe junto com a lista. */
  readonly mode = computed(() => (this.resource.hasValue() ? (this.resource.value().meta?.mode ?? null) : null));

  reload(): void {
    this.resource.reload();
  }

  /** Abrir a conversa marca como lida no servidor; aqui só acompanha sem esperar a próxima busca. */
  markRead(phone: string): void {
    if (!this.resource.hasValue() || !this.conversations().some((c) => c.phone === phone && c.unread > 0)) return;
    this.resource.set({ ...this.resource.value(), data: this.conversations().map((c) => (c.phone === phone ? { ...c, unread: 0 } : c)) });
  }
}

export function conversationTitle(c: Pick<InboxConversation, 'contact' | 'phone_display'>): string {
  return c.contact?.name || c.phone_display;
}

/** Prévia da última mensagem na lista. */
export function lastMessagePreview(c: InboxConversation): string {
  const body = c.last_message.body.replace(/\s+/g, ' ').trim();
  return c.last_message.direction === 'out' ? `Você: ${body}` : body;
}

export const OUT_STATUS: Readonly<Record<string, string>> = {
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  failed: 'Não entregue',
};

const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayDiff(date: Date, now: Date): number {
  return Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
}

export function messageTime(iso: string | null): string {
  return iso ? TIME.format(new Date(iso)) : '';
}

/** "Hoje", "Ontem" ou "05/11" (separador de dias na conversa). */
export function dayLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  const diff = dayDiff(date, now);
  if (diff === 0) return 'Hoje';
  if (diff === -1) return 'Ontem';
  return DAY_MONTH.format(date);
}

/** "15:40", "amanhã às 09:12" ou "14/11 às 09:12". */
export function windowClosesText(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  const diff = dayDiff(date, now);
  if (diff === 0) return TIME.format(date);
  if (diff === 1) return `amanhã às ${TIME.format(date)}`;
  return `${DAY_MONTH.format(date)} às ${TIME.format(date)}`;
}

export interface MessageGroup {
  day: string;
  messages: InboxMessage[];
}

/** Mensagens agrupadas por dia, na ordem. */
export function groupByDay(messages: readonly InboxMessage[], now: Date = new Date()): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const m of messages) {
    const day = dayLabel(m.created_at, now);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.messages.push(m);
    else groups.push({ day, messages: [m] });
  }
  return groups;
}

/** Telefone para a simulação: "+55 11 99999-0000" → "+5511999990000"; null se inválido. */
export function normalizePhone(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
}

export const REPLY_MAX = 4096;
