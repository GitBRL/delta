import { Injectable, computed, inject, signal } from '@angular/core';
import { TenantSummary } from '../api/api.types';
import { AuthService } from '../auth/auth.service';

const STORAGE_KEY = 'delta.tenant';
const ADMIN_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* sem armazenamento: a escolha vale só nesta sessão */
  }
}

/**
 * Agência (tenant) selecionada.
 * O localStorage guarda só a preferência; a fonte da verdade é a lista de tenants de /api/me,
 * e o backend valida a participação em toda requisição (RLS).
 */
@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly auth = inject(AuthService);
  private readonly preferred = signal<string | null>(readStored());

  readonly tenants = computed<TenantSummary[]>(() => this.auth.user()?.tenants ?? []);

  readonly current = computed<TenantSummary | null>(() => {
    const list = this.tenants();
    return list.find((t) => t.id === this.preferred()) ?? list[0] ?? null;
  });

  readonly currentId = computed(() => this.current()?.id ?? null);

  /** Dono ou administrador da agência: configura os apps das plataformas. O backend confere de novo. */
  readonly isAdmin = computed(() => ADMIN_ROLES.has(this.current()?.role ?? ''));

  select(id: string): void {
    if (!this.tenants().some((t) => t.id === id)) {
      return;
    }
    this.preferred.set(id);
    writeStored(id);
  }
}
