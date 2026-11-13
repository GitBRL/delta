import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DS_ICONS, DsIconName, DsIconNode } from './icons';

/**
 * Ícone em SVG próprio, sem dependências: `<svg dsIcon="info" [size]="20"></svg>`.
 * Mesmo traço do Lucide (24×24, stroke 2, pontas arredondadas, cor do texto).
 */
@Component({
  // Seletor de atributo em <svg> de propósito (como o Lucide): o host já é o próprio SVG.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'svg[dsIcon]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ds-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    '[attr.width]': 'size()',
    '[attr.height]': 'size()',
  },
  template: `
    @for (node of nodes(); track $index) {
      @let a = node[1];
      @switch (node[0]) {
        @case ('path') {
          <svg:path [attr.d]="a['d']" />
        }
        @case ('circle') {
          <svg:circle [attr.cx]="a['cx']" [attr.cy]="a['cy']" [attr.r]="a['r']" />
        }
        @case ('line') {
          <svg:line [attr.x1]="a['x1']" [attr.x2]="a['x2']" [attr.y1]="a['y1']" [attr.y2]="a['y2']" />
        }
        @case ('rect') {
          <svg:rect [attr.x]="a['x']" [attr.y]="a['y']" [attr.width]="a['width']" [attr.height]="a['height']" [attr.rx]="a['rx']" />
        }
      }
    }
  `,
})
export class DsIcon {
  readonly dsIcon = input.required<DsIconName>();
  readonly size = input(20);

  protected readonly nodes = computed<readonly DsIconNode[]>(() => DS_ICONS[this.dsIcon()] ?? []);
}
