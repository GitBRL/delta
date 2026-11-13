import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Signal, inject, signal } from '@angular/core';
import { Subject, catchError, debounceTime, map, of, startWith, switchMap } from 'rxjs';
import { API, ApiEnvelope, CustomMetricPreviewBody, MetricResult, TENANT_HEADER } from '../api/api.types';
import { extractFieldErrors } from '../forms/server-errors';

export type PreviewState =
  | { status: 'idle' }
  /** `previous`: último resultado válido, mostrado esmaecido enquanto recalcula. */
  | { status: 'loading'; previous: MetricResult | null }
  | { status: 'ready'; result: MetricResult }
  /** 422 de fórmula: mensagem pronta do backend, exibida junto do campo. */
  | { status: 'invalid'; message: string }
  | { status: 'error'; message: string };

export interface FormulaPreview {
  readonly state: Signal<PreviewState>;
  /** Agenda um preview; `null` limpa. Chamadas em sequência são agrupadas (debounce). */
  schedule(request: { tenantId: string; body: CustomMetricPreviewBody } | null): void;
}

export const PREVIEW_DEBOUNCE_MS = 400;

/**
 * Preview ao vivo de um indicador enquanto a pessoa digita.
 * Debounce de 400 ms; uma requisição nova cancela a anterior (switchMap), então uma resposta
 * antiga nunca sobrescreve o resultado da fórmula atual. Chamar em contexto de injeção.
 */
export function createFormulaPreview(debounceMs = PREVIEW_DEBOUNCE_MS): FormulaPreview {
  const http = inject(HttpClient);
  const state = signal<PreviewState>({ status: 'idle' });
  const requests = new Subject<{ tenantId: string; body: CustomMetricPreviewBody } | null>();
  let lastReady: MetricResult | null = null;

  const subscription = requests
    .pipe(
      debounceTime(debounceMs),
      switchMap((request) => {
        if (!request) return of<PreviewState>({ status: 'idle' });
        return http
          .post<ApiEnvelope<MetricResult>>(API.customMetricsPreview, request.body, {
            headers: { [TENANT_HEADER]: request.tenantId },
          })
          .pipe(
            map((res): PreviewState => ({ status: 'ready', result: res.data })),
            catchError((error: unknown) => of(previewError(error))),
            startWith<PreviewState>({ status: 'loading', previous: lastReady }),
          );
      }),
    )
    .subscribe((next) => {
      if (next.status === 'ready') lastReady = next.result;
      else if (next.status !== 'loading') lastReady = null;
      state.set(next);
    });

  inject(DestroyRef).onDestroy(() => subscription.unsubscribe());

  return {
    state: state.asReadonly(),
    schedule: (request) => requests.next(request),
  };
}

function previewError(error: unknown): PreviewState {
  const fields = extractFieldErrors(error);
  if (fields) {
    const message = fields['formula'] ?? Object.values(fields)[0] ?? 'Revise a fórmula.';
    return { status: 'invalid', message };
  }
  if (error instanceof HttpErrorResponse && error.status === 0) {
    return { status: 'error', message: 'Sem conexão com o servidor.' };
  }
  return { status: 'error', message: 'Não foi possível calcular o preview.' };
}
