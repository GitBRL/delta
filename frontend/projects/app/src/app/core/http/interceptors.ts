import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { DsToastService } from 'design-system';
import { catchError, throwError } from 'rxjs';
import { API, TENANT_HEADER } from '../api/api.types';
import { AuthService } from '../auth/auth.service';
import { PlanLimitService, planLimitNotice } from '../billing/plan-limit';
import { TenantService } from '../tenant/tenant.service';

const BACKEND_PREFIXES = ['/api/', '/auth/', '/sanctum/'];
/** Telas que mostram a própria mensagem de 403 (ex.: convite para outro e-mail). */
const OWN_FORBIDDEN_MESSAGE = ['/api/invitations/', '/api/public/'];
/** Rotas públicas (sem agência e sem sessão): 401 é da tela (ex.: relatório com senha), não "sessão expirou". */
const PUBLIC_PREFIXES = ['/api/public/'];

function isPublicUrl(url: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function isBackendUrl(url: string): boolean {
  return BACKEND_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/** Envia cookies (sessão + XSRF) nas chamadas ao backend, mesmo se ele estiver em outra origem. */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) =>
  next(isBackendUrl(req.url) ? req.clone({ withCredentials: true }) : req);

/** Injeta X-Tenant-Id em /api/* quando há agência selecionada (sem sobrescrever um header explícito). */
export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/') || isPublicUrl(req.url) || req.headers.has(TENANT_HEADER)) {
    return next(req);
  }
  const tenantId = inject(TenantService).currentId();
  return next(tenantId ? req.clone({ setHeaders: { [TENANT_HEADER]: tenantId } }) : req);
};

/**
 * Tratamento global:
 *  - 401 fora do fluxo de sessão → limpa o estado e volta ao login;
 *  - 403 → avisa que não há acesso à agência/recurso (exceto onde a tela explica o motivo).
 *  - 402 → limite do plano (ADR 0031): diálogo "Limite do plano" no shell.
 * 422 fica com a tela (erros por campo).
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const auth = inject(AuthService);
  const toast = inject(DsToastService);
  const planLimit = inject(PlanLimitService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        const isSessionProbe = req.url === API.me || req.url.startsWith('/auth/');
        if (error.status === 401 && !isSessionProbe && !isPublicUrl(req.url)) {
          auth.clear();
          void router.navigate(['/login'], { queryParams: { redirect: router.url } });
        } else if (error.status === 402 && !isPublicUrl(req.url)) {
          const notice = planLimitNotice(error);
          if (notice) planLimit.show(notice);
        } else if (error.status === 403 && !OWN_FORBIDDEN_MESSAGE.some((prefix) => req.url.startsWith(prefix))) {
          toast.error('Sem acesso', { message: 'Você não tem permissão para acessar este recurso nesta agência.' });
        } else if (error.status === 0 || error.status >= 500) {
          toast.error('Não foi possível falar com o servidor', {
            message: 'Tente novamente em instantes.',
          });
        }
      }
      return throwError(() => error);
    }),
  );
};
