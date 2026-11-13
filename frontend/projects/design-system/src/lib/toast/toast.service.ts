import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

export interface ToastOptions {
  message?: string;
  /** Tempo em ms até sumir sozinho; 0 = só fecha manualmente. */
  timeout?: number;
}

@Injectable({ providedIn: 'root' })
export class DsToastService {
  private seq = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly items = signal<Toast[]>([]);

  readonly toasts = this.items.asReadonly();

  show(kind: ToastKind, title: string, options: ToastOptions = {}): number {
    const id = ++this.seq;
    this.items.update((list) => [...list.slice(-3), { id, kind, title, message: options.message }]);

    const timeout = options.timeout ?? (kind === 'error' ? 7000 : 4000);
    if (timeout > 0) {
      this.timers.set(
        id,
        setTimeout(() => this.dismiss(id), timeout),
      );
    }
    return id;
  }

  success(title: string, options?: ToastOptions): number {
    return this.show('success', title, options);
  }

  error(title: string, options?: ToastOptions): number {
    return this.show('error', title, options);
  }

  info(title: string, options?: ToastOptions): number {
    return this.show('info', title, options);
  }

  dismiss(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.items.update((list) => list.filter((t) => t.id !== id));
  }
}
