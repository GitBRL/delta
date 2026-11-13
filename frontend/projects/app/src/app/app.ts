import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DsThemeService, DsToastOutlet } from 'design-system';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, DsToastOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <ds-toast-outlet />
  `,
})
export class App {
  constructor() {
    // Instancia o serviço de tema logo no início para aplicar a preferência salva.
    inject(DsThemeService);
  }
}
