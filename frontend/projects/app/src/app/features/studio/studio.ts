import { HttpErrorResponse } from '@angular/common/http';
import {
  CompareMode,
  CreatePresentationBody,
  PresentationFormat,
  PresentationStatus,
  ReportData,
  ReportPeriodPreset,
} from '../../core/api/api.types';
import { FieldErrors } from '../../core/forms/server-errors';

/** Enquanto a IA gera (10 a 60 s), a tela consulta a apresentação a cada 3 s. */
export const STUDIO_POLL_MS = 3_000;
export const BRIEF_LIMITS = { min: 10, max: 2000 } as const;
export const INSTRUCTION_LIMITS = { min: 3, max: 1000 } as const;

export const FORMAT_TEXT: Readonly<Record<PresentationFormat, string>> = {
  slides: 'Slides',
  page: 'Página única',
};

export const STATUS_TEXT: Readonly<Record<PresentationStatus, string>> = {
  generating: 'Gerando…',
  ready: 'Pronta',
  error: 'Falhou',
};

export interface PresentationDraft {
  project_id: string;
  brief: string;
  title: string;
  format: PresentationFormat;
  period_preset: ReportPeriodPreset;
  period_start: string;
  period_end: string;
  compare: CompareMode;
}

export function emptyDraft(projectId = ''): PresentationDraft {
  return {
    project_id: projectId,
    brief: '',
    title: '',
    format: 'slides',
    period_preset: 'last_30',
    period_start: '',
    period_end: '',
    compare: 'previous_period',
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function validateDraft(d: PresentationDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!d.project_id) errors['project_id'] = 'Escolha o projeto.';
  const brief = d.brief.trim();
  if (brief.length < BRIEF_LIMITS.min) errors['brief'] = 'Descreva um pouco mais (pelo menos 10 caracteres).';
  else if (brief.length > BRIEF_LIMITS.max) errors['brief'] = `Use no máximo ${BRIEF_LIMITS.max} caracteres.`;
  if (d.title.trim().length > 160) errors['title'] = 'Use no máximo 160 caracteres.';
  if (d.period_preset === 'custom') {
    if (!ISO.test(d.period_start)) errors['period_start'] = 'Informe o início.';
    if (!ISO.test(d.period_end)) errors['period_end'] = 'Informe o fim.';
    else if (ISO.test(d.period_start) && d.period_end < d.period_start) errors['period_end'] = 'O fim vem depois do início.';
  }
  return errors;
}

export function createBody(d: PresentationDraft): CreatePresentationBody {
  const custom = d.period_preset === 'custom';
  return {
    project_id: d.project_id,
    brief: d.brief.trim(),
    title: d.title.trim() || null,
    format: d.format,
    period_preset: d.period_preset,
    period_start: custom ? d.period_start : null,
    period_end: custom ? d.period_end : null,
    compare: d.compare,
  };
}

/** Slide 0 = capa; slide i = seção i-1 do relatório renderizado. */
export function slideCount(data: ReportData | null): number {
  return data ? data.sections.length + 1 : 0;
}

/** Dados de um slide: a capa (sem seções) ou uma seção só. */
export function slideData(data: ReportData, index: number): ReportData {
  if (index <= 0) return { ...data, sections: [] };
  const section = data.sections[index - 1];
  return { ...data, sections: section ? [section] : [] };
}

export function clampSlide(index: number, count: number): number {
  return Math.max(0, Math.min(index, Math.max(0, count - 1)));
}

/** Mensagem do 422 em `errors.ai` (IA não configurada ou orçamento acabou). */
export function aiError(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 422) return null;
  const messages = (error.error as { errors?: Record<string, string[]> } | null)?.errors?.['ai'];
  return Array.isArray(messages) && messages.length > 0 ? String(messages[0]) : null;
}

/** Mensagem JSON de uma resposta de erro em blob (download do PDF). */
export async function blobMessage(body: unknown): Promise<string | null> {
  try {
    const text = body instanceof Blob ? await body.text() : typeof body === 'string' ? body : JSON.stringify(body);
    const parsed = JSON.parse(text) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : null;
  } catch {
    return null;
  }
}
