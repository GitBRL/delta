import { TestBed } from '@angular/core/testing';
import { STATUS_LEVELS, statusMeta } from './status';
import { DsStatusBadge } from './status-badge';

describe('statusMeta', () => {
  it('mapeia cada estado para rótulo, emoji e cor', () => {
    expect(statusMeta('healthy')).toMatchObject({ label: 'Saudável', emoji: '🟢', colorVar: '--ds-status-healthy' });
    expect(statusMeta('attention')).toMatchObject({ label: 'Atenção', emoji: '🟡', colorVar: '--ds-status-attention' });
    expect(statusMeta('critical')).toMatchObject({ label: 'Crítico', emoji: '🔴', colorVar: '--ds-status-critical' });
    expect(statusMeta('opportunity')).toMatchObject({
      label: 'Oportunidade',
      emoji: '🔵',
      colorVar: '--ds-status-opportunity',
    });
  });

  it('só estados que pedem ação pulsam', () => {
    const pulsing = STATUS_LEVELS.filter((s) => statusMeta(s).pulses);
    expect(pulsing).toEqual(['attention', 'critical']);
  });
});

describe('DsStatusBadge', () => {
  it('renderiza rótulo padrão, aria-label e classe de pulso', async () => {
    const fixture = TestBed.createComponent(DsStatusBadge);
    fixture.componentRef.setInput('status', 'critical');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.getAttribute('data-status')).toBe('critical');
    expect(host.getAttribute('aria-label')).toBe('Status: Crítico');
    expect(host.classList.contains('pulses')).toBe(true);
    expect(host.textContent?.trim()).toBe('Crítico');
  });

  it('aceita rótulo próprio e modo compacto', async () => {
    const fixture = TestBed.createComponent(DsStatusBadge);
    fixture.componentRef.setInput('status', 'healthy');
    fixture.componentRef.setInput('label', 'Dentro da meta');
    fixture.componentRef.setInput('compact', true);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.getAttribute('aria-label')).toBe('Status: Dentro da meta');
    expect(host.classList.contains('pulses')).toBe(false);
    expect(host.querySelector('.text')).toBeNull();
  });

  it('permite forçar o pulso (ex.: sincronização em andamento)', async () => {
    const fixture = TestBed.createComponent(DsStatusBadge);
    fixture.componentRef.setInput('status', 'opportunity');
    fixture.componentRef.setInput('pulse', true);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).classList.contains('pulses')).toBe(true);
  });
});
