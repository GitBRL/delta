import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DsIcon } from '../icon/icon';
import { DsToastService } from './toast.service';

/** Renderiza as notificações. Coloque uma vez no componente raiz: <ds-toast-outlet /> */
@Component({
  selector: 'ds-toast-outlet',
  imports: [DsIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ds-toast-outlet', 'aria-live': 'polite', 'aria-atomic': 'false' },
  template: `
    @for (toast of service.toasts(); track toast.id) {
      <div
        class="toast ds-glass"
        [attr.data-kind]="toast.kind"
        [attr.role]="toast.kind === 'error' ? 'alert' : 'status'"
        animate.enter="toast-in"
        animate.leave="toast-out"
      >
        <span class="icon" aria-hidden="true">
          @switch (toast.kind) {
            @case ('success') {
              <svg dsIcon="circle-check" [size]="20"></svg>
            }
            @case ('error') {
              <svg dsIcon="circle-exclamation-point" [size]="20"></svg>
            }
            @default {
              <svg dsIcon="info" [size]="20"></svg>
            }
          }
        </span>
        <div class="text">
          <strong>{{ toast.title }}</strong>
          @if (toast.message) {
            <span>{{ toast.message }}</span>
          }
        </div>
        <button type="button" class="close" (click)="service.dismiss(toast.id)" aria-label="Fechar notificação">
          <svg dsIcon="x" [size]="16"></svg>
        </button>
      </div>
    }
  `,
  styleUrl: './toast-outlet.css',
})
export class DsToastOutlet {
  protected readonly service = inject(DsToastService);
}
