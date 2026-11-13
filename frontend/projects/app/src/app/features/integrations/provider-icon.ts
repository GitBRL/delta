import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  LucideBriefcase,
  LucideCamera,
  LucideChartLine,
  LucideMegaphone,
  LucideMousePointerClick,
  LucideMusic,
  LucidePlug,
  LucideSearch,
  LucideSquarePlay,
  LucideStore,
  LucideUsers,
} from '@lucide/angular';

/**
 * Ícone genérico por canal. Não usa logotipos das plataformas (marcas de terceiros).
 */
@Component({
  selector: 'app-provider-icon',
  imports: [
    LucideMegaphone,
    LucideMousePointerClick,
    LucideChartLine,
    LucideCamera,
    LucideUsers,
    LucideSearch,
    LucideSquarePlay,
    LucideStore,
    LucideMusic,
    LucideBriefcase,
    LucidePlug,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'inline-grid place-items-center' },
  template: `
    @switch (provider()) {
      @case ('meta_ads') { <svg lucideMegaphone [size]="size()"></svg> }
      @case ('google_ads') { <svg lucideMousePointerClick [size]="size()"></svg> }
      @case ('ga4') { <svg lucideChartLine [size]="size()"></svg> }
      @case ('instagram') { <svg lucideCamera [size]="size()"></svg> }
      @case ('facebook') { <svg lucideUsers [size]="size()"></svg> }
      @case ('search_console') { <svg lucideSearch [size]="size()"></svg> }
      @case ('youtube') { <svg lucideSquarePlay [size]="size()"></svg> }
      @case ('google_business') { <svg lucideStore [size]="size()"></svg> }
      @case ('tiktok_ads') { <svg lucideMusic [size]="size()"></svg> }
      @case ('linkedin_ads') { <svg lucideBriefcase [size]="size()"></svg> }
      @default { <svg lucidePlug [size]="size()"></svg> }
    }
  `,
})
export class ProviderIcon {
  readonly provider = input.required<string>();
  readonly size = input(20);
}
