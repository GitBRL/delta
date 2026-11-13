import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DsIcon } from './icon';
import { DS_ICONS } from './icons';

@Component({
  imports: [DsIcon],
  template: `<svg dsIcon="circle-check" [size]="18"></svg><svg dsIcon="monitor"></svg>`,
})
class Host {}

describe('DsIcon', () => {
  it('desenha o ícone em SVG próprio, decorativo, na cor do texto', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const [check, monitor] = fixture.nativeElement.querySelectorAll('svg') as NodeListOf<SVGSVGElement>;

    expect(check.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(check.getAttribute('width')).toBe('18');
    expect(check.getAttribute('stroke')).toBe('currentColor');
    expect(check.getAttribute('aria-hidden')).toBe('true');
    expect(check.querySelector('circle')?.getAttribute('r')).toBe('10');
    expect(check.querySelector('path')?.getAttribute('d')).toBe(DS_ICONS['circle-check'][1][1]['d']);
    expect(monitor.getAttribute('width')).toBe('20');
    expect(monitor.querySelectorAll('rect, line')).toHaveLength(3);
  });

  it('tem os ícones do que carrega no início (toast, shell e tema)', () => {
    for (const name of ['circle-check', 'circle-exclamation-point', 'info', 'x', 'sun', 'moon', 'monitor', 'layout-dashboard', 'send', 'log-out']) {
      expect(DS_ICONS[name as keyof typeof DS_ICONS].length).toBeGreaterThan(0);
    }
  });
});
