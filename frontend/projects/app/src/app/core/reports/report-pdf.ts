import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, TENANT_HEADER } from '../api/api.types';

export type PdfDownloadResult = 'downloaded' | 'pending' | 'failed';

/** "relatorio-de-outubro.pdf" */
export function pdfFilename(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'relatorio'}.pdf`;
}

async function blobMessage(body: unknown): Promise<string | null> {
  try {
    const text = body instanceof Blob ? await body.text() : typeof body === 'string' ? body : JSON.stringify(body);
    const parsed = JSON.parse(text) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : null;
  } catch {
    return null;
  }
}

/**
 * Download do PDF de uma versão publicada. Vai por HttpClient (blob) porque a rota da agência
 * precisa do X-Tenant-Id; o link público usa a URL assinada que o backend devolve.
 * 202 = ainda gerando; 409 = falhou (a equipe pode pedir de novo).
 */
@Injectable({ providedIn: 'root' })
export class ReportPdfService {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);

  /** PDF de uma versão (equipe ou cliente, dentro da agência). */
  snapshot(snapshotId: string, title: string, tenantId: string | null): Promise<PdfDownloadResult> {
    const headers = tenantId ? { [TENANT_HEADER]: tenantId } : undefined;
    return this.fetch(API.snapshotPdf(snapshotId), title, headers);
  }

  /** PDF pelo link público (URL relativa assinada). */
  public(url: string, title: string): Promise<PdfDownloadResult> {
    return this.fetch(url, title);
  }

  private async fetch(url: string, title: string, headers?: Record<string, string>): Promise<PdfDownloadResult> {
    try {
      const res = await firstValueFrom(this.http.get(url, { headers, observe: 'response', responseType: 'blob' }));
      if (res.status === 202 || !res.body) {
        this.toast.info('O PDF ainda está sendo gerado', {
          message: (await blobMessage(res.body)) ?? 'Tente de novo em alguns segundos.',
        });
        return 'pending';
      }
      saveBlob(res.body, pdfFilename(title));
      return 'downloaded';
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.toast.error('Não foi possível gerar o PDF', {
          message: (await blobMessage(error.error)) ?? 'Peça para gerar de novo.',
        });
        return 'failed';
      }
      if (error instanceof HttpErrorResponse && error.status === 410) {
        this.toast.error('Link indisponível', { message: (await blobMessage(error.error)) ?? undefined });
        return 'failed';
      }
      // 403/5xx/rede já viram toast no interceptor global.
      if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
        this.toast.error('Não foi possível baixar o PDF');
      }
      return 'failed';
    }
  }
}

/** Salva o blob como arquivo (no navegador; em testes sem URL.createObjectURL, não faz nada). */
export function saveBlob(blob: Blob, filename: string): void {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
