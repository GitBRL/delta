import { ConsentSource, Contact, ContactBody, ContactChannel } from '../../core/api/api.types';

export const CHANNEL_LABEL: Readonly<Record<ContactChannel, string>> = { email: 'E-mail', whatsapp: 'WhatsApp' };

export const CONSENT_SOURCE_LABEL: Readonly<Record<ConsentSource, string>> = {
  manual: 'registrado pela equipe',
  unsubscribe_link: 'pelo link de descadastro',
  whatsapp_reply: 'respondendo PARAR no WhatsApp',
};

export interface ContactDraft {
  name: string;
  role: string;
  email: string;
  phone: string;
  email_opt_in: boolean;
  whatsapp_opt_in: boolean;
}

export const EMPTY_CONTACT: ContactDraft = { name: '', role: '', email: '', phone: '', email_opt_in: false, whatsapp_opt_in: false };

export function draftFrom(contact: Contact): ContactDraft {
  return {
    name: contact.name,
    role: contact.role ?? '',
    email: contact.email ?? '',
    phone: contact.phone_display ?? contact.phone ?? '',
    email_opt_in: contact.email_opt_in,
    whatsapp_opt_in: contact.whatsapp_opt_in,
  };
}

/** Corpo do POST/PUT: campos vazios viram null e o consentimento só vale com o canal preenchido. */
export function contactBody(draft: ContactDraft): ContactBody {
  const email = draft.email.trim();
  const phone = draft.phone.trim();
  return {
    name: draft.name.trim(),
    role: draft.role.trim() || null,
    email: email || null,
    phone: phone || null,
    email_opt_in: !!email && draft.email_opt_in,
    whatsapp_opt_in: !!phone && draft.whatsapp_opt_in,
  };
}

/** Mesmas regras básicas do backend (que normaliza e valida o telefone). */
export function validateContact(draft: ContactDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.name.trim().length < 2) errors['name'] = 'Informe o nome do contato.';
  if (!draft.email.trim() && !draft.phone.trim()) errors['email'] = 'Informe ao menos um e-mail ou um WhatsApp.';
  if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors['email'] = 'Este e-mail não parece válido.';
  return errors;
}

/** Por que o contato não pode receber pelo canal (null = pode). */
export function channelBlocker(contact: Contact, channel: ContactChannel): string | null {
  if (channel === 'email') {
    if (!contact.email) return 'Sem e-mail cadastrado';
    if (!contact.email_opt_in) return 'Sem consentimento para e-mail';
  } else {
    if (!contact.phone) return 'Sem WhatsApp cadastrado';
    if (!contact.whatsapp_opt_in) return 'Sem consentimento para WhatsApp';
  }
  return null;
}

/** Recebe por pelo menos um dos canais escolhidos? */
export function canReceiveAny(contact: Contact, channels: readonly ContactChannel[]): boolean {
  return channels.some((channel) => channelBlocker(contact, channel) === null);
}
