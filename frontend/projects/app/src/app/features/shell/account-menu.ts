import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  isDevMode,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { DsIcon, DsIconName, DsThemeService, DsToastService, ThemeMode } from 'design-system';
import { AuthService } from '../../core/auth/auth.service';
import { TenantService } from '../../core/tenant/tenant.service';

const THEMES: readonly { mode: ThemeMode; label: string; icon: DsIconName }[] = [
  { mode: 'system', label: 'Sistema', icon: 'monitor' },
  { mode: 'light', label: 'Claro', icon: 'sun' },
  { mode: 'dark', label: 'Escuro', icon: 'moon' },
];

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/**
 * Rodapé da sidebar: a pessoa (nome e e-mail inteiros) abre um menu com Minha conta, tema e sair.
 * Padrão de divulgação (botão + painel), sem as setas de um menu ARIA: Tab percorre, Esc fecha.
 */
@Component({
  selector: 'app-account-menu',
  imports: [RouterLink, RouterLinkActive, DsIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-menu.html',
  styleUrl: './account-menu.css',
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(keydown.escape)': 'close(true)',
  },
})
export class AccountMenu {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(DsToastService);
  private readonly tenant = inject(TenantService);
  private readonly theme = inject(DsThemeService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly user = this.auth.user;
  protected readonly initials = computed(() => initialsOf(this.user()?.name ?? '?'));
  protected readonly open = signal(false);
  protected readonly loggingOut = signal(false);
  protected readonly themes = THEMES;
  protected readonly themeMode = this.theme.mode;
  /** Vitrine de componentes: ferramenta da equipe de desenvolvimento, fora do build de produção. */
  protected readonly showDesignSystem = computed(
    () => isDevMode() && this.tenant.current()?.role !== 'client',
  );

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.open.set(false);
      }
    });
  }

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  /** Fecha o menu; pelo teclado (Esc), o foco volta para o botão da conta. */
  protected close(returnFocus = false): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);
    if (returnFocus) {
      this.host.nativeElement.querySelector<HTMLButtonElement>('button.account')?.focus();
    }
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  protected setTheme(mode: ThemeMode): void {
    this.theme.set(mode);
  }

  protected async logout(): Promise<void> {
    this.open.set(false);
    this.loggingOut.set(true);
    try {
      await this.auth.logout();
    } catch {
      this.toast.info('Sessão encerrada neste dispositivo');
    } finally {
      this.loggingOut.set(false);
      await this.router.navigateByUrl('/login');
    }
  }
}
