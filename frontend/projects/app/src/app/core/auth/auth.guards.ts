import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Exige sessão; senão manda para o login guardando o destino. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (await auth.ensureSession()) {
    return true;
  }
  return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
};

/** Telas de login/cadastro: quem já está logado vai para a Overview. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (await auth.ensureSession()) {
    return router.createUrlTree(['/overview']);
  }
  return true;
};
