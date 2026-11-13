import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PublicReport } from '../../core/api/api.types';
import { REPORT_DATA } from './report-fixtures';
import { TV_SECTION_MS, TV_TICK_MS, TvView } from './tv-view';

const LIVE: PublicReport = {
  title: 'Painel da loja',
  agency: 'Agência Norte',
  live: true,
  refreshed_at: new Date(Date.now() - 3 * 60_000).toISOString(),
  published_at: '2026-11-12T10:00:00Z',
  report: REPORT_DATA,
  pdf_status: null,
  pdf_url: null,
};

describe('TvView (modo TV)', () => {
  let fixture: ComponentFixture<TvView>;
  let el: HTMLElement;

  beforeEach(async () => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(TvView);
    fixture.componentRef.setInput('report', LIVE);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) => {
    vi.advanceTimersByTime(ms);
    fixture.detectChanges();
  };
  const sectionTitle = () => el.querySelector('.section-title')?.textContent?.trim();

  it('mostra uma seção por vez, sem capa, com selo ao vivo, relógio e contador', () => {
    expect(el.querySelectorAll('app-report-view .section')).toHaveLength(1);
    expect(el.querySelector('app-report-view .cover')).toBeNull();
    expect(sectionTitle()).toBe('Resumo do período');
    expect(el.querySelector('.live')?.textContent).toContain('Ao vivo · atualizado há 3 minutos');
    expect(el.querySelector('.count')?.textContent).toContain('Seção 1 de 2');
    expect(el.querySelector('.clock')?.textContent).toMatch(/^\d{2}:\d{2}$/);
    expect(el.querySelector('.title')?.textContent).toContain('Painel da loja');
  });

  it('roda as seções a cada 20 s, com o progresso, e volta ao começo', () => {
    advance(TV_SECTION_MS / 2);
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(sectionTitle()).toBe('Resumo do período');

    advance(TV_SECTION_MS / 2);
    expect(sectionTitle()).toBe('Meta Ads');
    expect(el.querySelector('.count')?.textContent).toContain('Seção 2 de 2');
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0');

    advance(TV_SECTION_MS);
    expect(sectionTitle()).toBe('Resumo do período');
  });

  it('pausa com espaço, navega com as setas e sai com Esc', () => {
    const exited = vi.fn();
    fixture.componentInstance.exited.subscribe(exited);
    const key = (k: string) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      fixture.detectChanges();
    };

    key(' ');
    advance(TV_SECTION_MS * 2);
    expect(sectionTitle()).toBe('Resumo do período');
    expect(el.querySelector('[aria-pressed="true"]')?.getAttribute('aria-label')).toBe('Retomar rotação');

    key('ArrowRight');
    expect(sectionTitle()).toBe('Meta Ads');
    key('ArrowLeft');
    expect(sectionTitle()).toBe('Resumo do período');

    key('Escape');
    expect(exited).toHaveBeenCalledTimes(1);
  });

  it('atualiza o relógio a cada segundo e não gira com uma seção só', () => {
    fixture.componentRef.setInput('report', { ...LIVE, live: false, report: { ...REPORT_DATA, sections: [REPORT_DATA.sections[0]] } });
    fixture.detectChanges();
    const before = fixture.componentInstance.now();
    advance(TV_TICK_MS);
    expect(fixture.componentInstance.now().getTime()).toBeGreaterThan(before.getTime());
    advance(TV_SECTION_MS * 2);
    expect(sectionTitle()).toBe('Resumo do período');
    expect(el.querySelector('[role="progressbar"]')).toBeNull();
    expect(el.querySelector('.live')).toBeNull();
  });
});
