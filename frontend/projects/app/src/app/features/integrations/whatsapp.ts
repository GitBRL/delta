import { WhatsAppMode, WhatsAppSettings, WhatsAppSettingsBody, WhatsAppStatus } from '../../core/api/api.types';

export const WHATSAPP_STATUS: Readonly<Record<WhatsAppStatus, { label: string; tone: 'muted' | 'ok' | 'warn' | 'bad' }>> = {
  sandbox: { label: 'Demonstração', tone: 'muted' },
  unverified: { label: 'Número oficial · não verificado', tone: 'warn' },
  verified: { label: 'Número oficial verificado', tone: 'ok' },
  invalid: { label: 'Credenciais recusadas', tone: 'bad' },
};

export interface WhatsAppDraft {
  mode: WhatsAppMode;
  phone_number_id: string;
  waba_id: string;
  access_token: string;
  app_secret: string;
  template_name: string;
  template_language: string;
}

export function whatsappDraftFrom(s: WhatsAppSettings): WhatsAppDraft {
  return {
    mode: s.mode,
    phone_number_id: s.phone_number_id ?? '',
    waba_id: s.waba_id ?? '',
    access_token: '',
    app_secret: '',
    template_name: s.template_name ?? 'relatorio_periodico',
    template_language: s.template_language || 'pt_BR',
  };
}

/** Demonstração só precisa do modo; segredos em branco ficam de fora (o backend mantém os atuais). */
export function whatsappBody(draft: WhatsAppDraft): WhatsAppSettingsBody {
  if (draft.mode === 'sandbox') return { mode: 'sandbox' };
  const body: WhatsAppSettingsBody = {
    mode: 'cloud',
    phone_number_id: draft.phone_number_id.trim(),
    waba_id: draft.waba_id.trim() || null,
    template_name: draft.template_name.trim(),
    template_language: draft.template_language.trim() || 'pt_BR',
  };
  if (draft.access_token.trim()) body.access_token = draft.access_token.trim();
  if (draft.app_secret.trim()) body.app_secret = draft.app_secret.trim();
  return body;
}

export function validateWhatsApp(draft: WhatsAppDraft, settings: WhatsAppSettings): Record<string, string> {
  if (draft.mode === 'sandbox') return {};
  const errors: Record<string, string> = {};
  if (!/^\d{6,30}$/.test(draft.phone_number_id.trim())) errors['phone_number_id'] = 'O ID do número tem só dígitos.';
  if (!settings.has_access_token && !draft.access_token.trim()) errors['access_token'] = 'Informe o token de acesso permanente.';
  if (!settings.has_app_secret && !draft.app_secret.trim()) errors['app_secret'] = 'Informe a chave secreta do app.';
  if (!/^[a-z0-9_]{1,120}$/.test(draft.template_name.trim())) errors['template_name'] = 'Use letras minúsculas, números e _ (ex.: relatorio_periodico).';
  return errors;
}
