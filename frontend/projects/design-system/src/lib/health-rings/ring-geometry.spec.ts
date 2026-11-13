import { TestBed } from '@angular/core/testing';
import { DsHealthRings } from './health-rings';
import { clampPercent, ringAngles } from './ring-geometry';

describe('ringAngles', () => {
  it('até 50% só a peça A gira', () => {
    expect(ringAngles(0)).toEqual({ a: 0, b: 0 });
    expect(ringAngles(25)).toEqual({ a: 90, b: 0 });
    expect(ringAngles(50)).toEqual({ a: 180, b: 0 });
  });

  it('acima de 50% a peça B completa o anel', () => {
    expect(ringAngles(75)).toEqual({ a: 180, b: 90 });
    expect(ringAngles(100)).toEqual({ a: 180, b: 180 });
  });

  it('limita valores fora de 0–100', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(ringAngles(140)).toEqual({ a: 180, b: 180 });
  });
});

describe('DsHealthRings', () => {
  it('descreve os três anéis para leitores de tela', async () => {
    const fixture = TestBed.createComponent(DsHealthRings);
    fixture.componentRef.setInput('acquisition', 82);
    fixture.componentRef.setInput('engagement', 64.4);
    fixture.componentRef.setInput('conversion', 120);
    await fixture.whenStable();

    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg[role="img"]');
    expect(svg?.getAttribute('aria-label')).toBe(
      'Saúde da conta: Aquisição 82 de 100, Engajamento 64 de 100, Conversão 100 de 100',
    );
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.arc').length).toBe(6);
  });
});
