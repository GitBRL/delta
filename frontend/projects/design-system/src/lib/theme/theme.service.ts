import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'delta.theme';
const MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

function readStoredMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(value as ThemeMode) ? (value as ThemeMode) : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Tema claro/escuro/sistema via atributo `data-theme` no <html>.
 * Também aplica a cor de destaque (white label) sobrescrevendo `--ds-accent`.
 */
@Injectable({ providedIn: 'root' })
export class DsThemeService {
  private readonly document = inject(DOCUMENT);

  readonly mode = signal<ThemeMode>(readStoredMode());

  constructor() {
    effect(() => {
      const mode = this.mode();
      const root = this.document.documentElement;
      if (mode === 'system') {
        root.removeAttribute('data-theme');
      } else {
        root.setAttribute('data-theme', mode);
      }
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        /* armazenamento indisponível: preferência vale só nesta sessão */
      }
    });
  }

  set(mode: ThemeMode): void {
    this.mode.set(mode);
  }

  /** Alterna sistema → claro → escuro → sistema. */
  cycle(): void {
    const next = MODES[(MODES.indexOf(this.mode()) + 1) % MODES.length];
    this.mode.set(next);
  }

  /** Cor de destaque da marca (qualquer cor CSS). `null` volta ao padrão. */
  setAccent(color: string | null): void {
    const style = this.document.documentElement.style;
    if (color) {
      style.setProperty('--ds-accent', color);
    } else {
      style.removeProperty('--ds-accent');
    }
  }
}
