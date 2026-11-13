import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl } from '@angular/forms';
import { ValidationErrorBody } from '../api/api.types';

export type FieldErrors = Record<string, string>;

/** Extrai a primeira mensagem de cada campo de um 422 do Laravel. `null` se não for erro de validação. */
export function extractFieldErrors(error: unknown): FieldErrors | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 422) {
    return null;
  }
  const body = error.error as Partial<ValidationErrorBody> | null;
  const result: FieldErrors = {};
  for (const [field, messages] of Object.entries(body?.errors ?? {})) {
    if (Array.isArray(messages) && messages.length > 0) {
      result[field] = String(messages[0]);
    }
  }
  return result;
}

/** Mensagem geral de um 422 (ex.: "Credenciais inválidas"), quando houver. */
export function validationMessage(error: unknown): string | null {
  if (error instanceof HttpErrorResponse && error.status === 422) {
    return (error.error as Partial<ValidationErrorBody> | null)?.message ?? null;
  }
  return null;
}

/** Mensagem de erro de cliente para um controle, em pt-BR. */
export function clientErrorMessage(control: AbstractControl | null, label: string): string | null {
  if (!control || !control.errors || !(control.touched || control.dirty)) {
    return null;
  }
  const e = control.errors;
  if (e['required']) return `Informe ${label}.`;
  if (e['email']) return 'E-mail inválido.';
  if (e['minlength']) return `Use pelo menos ${e['minlength'].requiredLength} caracteres.`;
  if (e['maxlength']) return `Use no máximo ${e['maxlength'].requiredLength} caracteres.`;
  if (e['pattern']) return `Formato inválido.`;
  if (e['mismatch']) return 'As senhas não conferem.';
  return null;
}
