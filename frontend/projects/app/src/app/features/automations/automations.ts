import {
  Automation,
  AutomationBody,
  AutomationFrequency,
  AutomationRunDetail,
  ContactChannel,
  MessageStatus,
  RelativePeriodPreset,
  RunMessage,
  RunStatus,
} from '../../core/api/api.types';

export const DEFAULT_MESSAGE =
  'Olá, {{contato}}! O relatório de {{cliente}} ({{periodo}}) está pronto.\n\n{{resumo}}\n\nVeja o relatório completo: {{link}}';

export const MESSAGE_MAX = 2000;

export const VARIABLES: readonly { key: string; label: string; hint: string }[] = [
  { key: 'contato', label: 'Contato', hint: 'Primeiro nome de quem recebe' },
  { key: 'cliente', label: 'Cliente', hint: 'Nome do projeto' },
  { key: 'periodo', label: 'Período', hint: 'Ex.: 01/10/2026 – 31/10/2026' },
  { key: 'agencia', label: 'Agência', hint: 'Nome da sua agência' },
  { key: 'resumo', label: 'Resumo', hint: 'Até 5 KPIs com variação e semáforo' },
  { key: 'link', label: 'Link', hint: 'Relatório completo (link público de 90 dias)' },
];

export const FREQUENCIES: readonly { value: AutomationFrequency; label: string }[] = [
  { value: 'daily', label: 'Diária' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'biweekly', label: 'Quinzenal' },
  { value: 'monthly', label: 'Mensal' },
];

export const WEEKDAYS: readonly { value: number; label: string }[] = [
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' },
];

export const AUTOMATION_PERIODS: readonly { value: RelativePeriodPreset; label: string }[] = [
  { value: 'last_7', label: 'Últimos 7 dias' },
  { value: 'last_14', label: 'Últimos 14 dias' },
  { value: 'last_30', label: 'Últimos 30 dias' },
  { value: 'last_month', label: 'Mês passado' },
  { value: 'this_month', label: 'Este mês (até ontem)' },
];

/** Período sugerido para a frequência (semanal → últimos 7 dias, mensal → mês passado…). */
export function suggestedPeriod(frequency: AutomationFrequency): RelativePeriodPreset {
  return { daily: 'last_7', weekly: 'last_7', biweekly: 'last_14', monthly: 'last_month' }[frequency] as RelativePeriodPreset;
}

export const RUN_STATUS: Readonly<Record<RunStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' }>> = {
  awaiting_approval: { label: 'Aguardando aprovação', tone: 'warn' },
  sending: { label: 'Enviando', tone: 'info' },
  sent: { label: 'Enviado', tone: 'ok' },
  partial: { label: 'Enviado em parte', tone: 'warn' },
  failed: { label: 'Falhou', tone: 'bad' },
  cancelled: { label: 'Cancelado', tone: 'muted' },
};

export const MESSAGE_STATUS: Readonly<Record<MessageStatus, { label: string; ticks: string; tone: 'muted' | 'ok' | 'read' | 'bad' }>> = {
  queued: { label: 'Na fila', ticks: '…', tone: 'muted' },
  sent: { label: 'Enviado', ticks: '✓', tone: 'muted' },
  delivered: { label: 'Entregue', ticks: '✓✓', tone: 'muted' },
  read: { label: 'Lido', ticks: '✓✓', tone: 'read' },
  failed: { label: 'Falhou', ticks: '!', tone: 'bad' },
  skipped: { label: 'Não enviado', ticks: '–', tone: 'muted' },
};

export const PROVIDER_LABEL: Readonly<Record<string, string>> = {
  smtp: 'E-mail',
  meta_cloud: 'WhatsApp oficial',
  sandbox: 'WhatsApp (demonstração)',
};

export interface AutomationDraft {
  name: string;
  report_id: string;
  channels: ContactChannel[];
  frequency: AutomationFrequency;
  weekday: number;
  month_day: number;
  send_time: string;
  period_preset: RelativePeriodPreset;
  message: string;
  attach_pdf: boolean;
  requires_approval: boolean;
  active: boolean;
  recipient_ids: string[];
}

export const EMPTY_AUTOMATION: AutomationDraft = {
  name: '',
  report_id: '',
  channels: ['email', 'whatsapp'],
  frequency: 'weekly',
  weekday: 1,
  month_day: 1,
  send_time: '09:00',
  period_preset: 'last_7',
  message: DEFAULT_MESSAGE,
  attach_pdf: true,
  requires_approval: false,
  active: true,
  recipient_ids: [],
};

export function draftFromAutomation(a: Automation): AutomationDraft {
  return {
    name: a.name,
    report_id: a.report?.id ?? '',
    channels: [...a.channels],
    frequency: a.frequency,
    weekday: a.weekday ?? 1,
    month_day: a.month_day ?? 1,
    send_time: a.send_time,
    period_preset: a.period_preset,
    message: a.message,
    attach_pdf: a.attach_pdf,
    requires_approval: a.requires_approval,
    active: a.active,
    recipient_ids: a.recipients.map((r) => r.id),
  };
}

/** Corpo do POST (com report_id) ou do PUT (sem). Dia da semana/mês só quando a frequência usa. */
export function automationBody(draft: AutomationDraft, creating: boolean): AutomationBody {
  const weekly = draft.frequency === 'weekly' || draft.frequency === 'biweekly';
  return {
    name: draft.name.trim(),
    ...(creating ? { report_id: draft.report_id } : {}),
    channels: [...draft.channels],
    frequency: draft.frequency,
    weekday: weekly ? draft.weekday : null,
    month_day: draft.frequency === 'monthly' ? draft.month_day : null,
    send_time: draft.send_time,
    period_preset: draft.period_preset,
    message: draft.message,
    attach_pdf: draft.attach_pdf,
    requires_approval: draft.requires_approval,
    active: draft.active,
    recipient_ids: [...draft.recipient_ids],
  };
}

export function validateAutomation(draft: AutomationDraft, creating: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.name.trim().length < 2) errors['name'] = 'Dê um nome ao envio.';
  if (creating && !draft.report_id) errors['report_id'] = 'Escolha o relatório.';
  if (draft.channels.length === 0) errors['channels'] = 'Escolha ao menos um canal.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.send_time)) errors['send_time'] = 'Informe o horário (HH:MM).';
  if (draft.message.trim().length < 2) errors['message'] = 'Escreva a mensagem.';
  if (draft.message.length > MESSAGE_MAX) errors['message'] = `A mensagem pode ter no máximo ${MESSAGE_MAX} caracteres.`;
  if (draft.recipient_ids.length === 0) errors['recipient_ids'] = 'Escolha ao menos um contato.';
  return errors;
}

/** Insere "{{variavel}}" na posição do cursor. */
export function insertVariable(text: string, variable: string, start: number, end = start): { text: string; cursor: number } {
  const token = `{{${variable}}}`;
  const next = text.slice(0, start) + token + text.slice(end);
  return { text: next, cursor: start + token.length };
}

/** Ainda há o que mudar (fila, envio em curso, WhatsApp recém-enviado esperando entregue/lido)? */
export function isRunLive(run: AutomationRunDetail, now: Date = new Date()): boolean {
  if (run.status === 'sending') return true;
  return run.messages.some((m) => m.status === 'queued' || isFreshWhatsApp(m, now));
}

function isFreshWhatsApp(m: RunMessage, now: Date): boolean {
  if (m.channel !== 'whatsapp' || (m.status !== 'sent' && m.status !== 'delivered') || !m.sent_at) return false;
  return now.getTime() - new Date(m.sent_at).getTime() < 2 * 60_000;
}
