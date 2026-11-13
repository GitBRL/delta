import { HttpErrorResponse } from '@angular/common/http';

/** O Fortify responde 423 quando a ação exige a senha confirmada há pouco. */
export function needsPassword(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 423;
}

/** Nome sugerido para a passkey, pelo tipo de aparelho (a pessoa pode trocar). */
export function suggestedPasskeyName(userAgent: string): string {
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Meu dispositivo';
}

/** Códigos de recuperação, um por linha (para copiar ou guardar). */
export function recoveryCodesText(codes: readonly string[]): string {
  return codes.join('\n');
}

/** SVG do QR code do 2FA como imagem (imagem não executa script). */
export function svgDataUrl(svg: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(svg)) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

const DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

export function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : DATE.format(date);
}
