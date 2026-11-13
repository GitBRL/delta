import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DsKpiTile } from './kpi-tile';

describe('DsKpiTile', () => {
  let fixture: ComponentFixture<DsKpiTile>;
  let el: HTMLElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(DsKpiTile);
    fixture.componentRef.setInput('label', 'CPA');
    fixture.componentRef.setInput('value', 9.39);
    fixture.componentRef.setInput('format', 'currency');
    fixture.componentRef.setInput('trend', 0.12);
    fixture.componentRef.setInput('direction', 'down-is-good');
    fixture.componentRef.setInput('status', 'attention');
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  });

  it('expõe o valor final para leitores de tela (independente da animação)', () => {
    const value = el.querySelector('.value');
    expect(value?.getAttribute('aria-label')?.replace(/\u00a0/g, ' ')).toBe('CPA: R$ 9,39');
  });

  it('marca alta de CPA como desfavorável', () => {
    const trend = el.querySelector('.trend');
    expect(trend?.getAttribute('data-sentiment')).toBe('negative');
    expect(trend?.textContent).toContain('▲');
    expect(trend?.textContent).toContain('12%');
  });

  it('mostra o selo de status compacto', () => {
    const badge = el.querySelector('ds-status-badge');
    expect(badge?.getAttribute('data-status')).toBe('attention');
    expect(badge?.querySelector('.text')).toBeNull();
  });

  it('pulsa nos estados que pedem ação ou são oportunidade, e fica discreto quando saudável', async () => {
    const badge = () => el.querySelector('ds-status-badge')!;
    expect(badge().classList.contains('pulses')).toBe(true); // attention

    fixture.componentRef.setInput('status', 'opportunity');
    await fixture.whenStable();
    expect(badge().getAttribute('data-status')).toBe('opportunity');
    expect(badge().classList.contains('pulses')).toBe(true);

    fixture.componentRef.setInput('status', 'healthy');
    await fixture.whenStable();
    expect(badge().getAttribute('data-status')).toBe('healthy');
    expect(badge().classList.contains('pulses')).toBe(false);

    fixture.componentRef.setInput('status', null);
    await fixture.whenStable();
    expect(el.querySelector('ds-status-badge')).toBeNull();
  });

  it('sem tendência não renderiza a linha de variação', async () => {
    fixture.componentRef.setInput('trend', null);
    await fixture.whenStable();
    expect(el.querySelector('.trend')).toBeNull();
  });

  it('usa o formatador externo e marca valores aproximados', async () => {
    fixture.componentRef.setInput('formatter', (v: number) => `${v.toFixed(1)} x`);
    fixture.componentRef.setInput('value', 4.1);
    fixture.componentRef.setInput('approximate', true);
    await fixture.whenStable();

    const value = el.querySelector('.value');
    expect(value?.getAttribute('aria-label')).toBe('CPA: aproximadamente 4.1 x');
    expect(value?.querySelector('.approx')?.textContent).toBe('≈');
  });

  it('respeita o sentimento vindo de fora em vez de deduzir pela direção', async () => {
    fixture.componentRef.setInput('sentiment', 'neutral');
    await fixture.whenStable();
    expect(el.querySelector('.trend')?.getAttribute('data-sentiment')).toBe('neutral');
  });

  it('valor nulo mostra travessão e esconde a variação', async () => {
    fixture.componentRef.setInput('value', null);
    await fixture.whenStable();
    expect(el.querySelector('.value')?.textContent?.trim()).toBe('—');
    expect(el.querySelector('.value')?.getAttribute('aria-label')).toBe('CPA: sem dados');
    expect(el.querySelector('.trend')).toBeNull();
  });
});
