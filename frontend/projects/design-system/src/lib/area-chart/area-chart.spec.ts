import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DsAreaChart } from './area-chart';

const SERIES = [
  { date: '2026-11-01', value: 100 },
  { date: '2026-11-02', value: 250 },
  { date: '2026-11-03', value: null },
  { date: '2026-11-04', value: 180 },
];
const PREVIOUS = [
  { date: '2026-10-28', value: 90 },
  { date: '2026-10-29', value: 120 },
  { date: '2026-10-30', value: 140 },
  { date: '2026-10-31', value: 160 },
];

describe('DsAreaChart', () => {
  let fixture: ComponentFixture<DsAreaChart>;
  let el: HTMLElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(DsAreaChart);
    fixture.componentRef.setInput('label', 'Investimento');
    fixture.componentRef.setInput('series', SERIES);
    fixture.componentRef.setInput('comparison', PREVIOUS);
    fixture.componentRef.setInput('valueFormatter', (v: number) => `R$ ${v}`);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  });

  const frame = () => el.querySelector<HTMLElement>('.frame')!;
  const key = async (k: string) => {
    frame().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    await fixture.whenStable();
  };

  it('desenha linha, área e comparação a partir da geometria', () => {
    const g = fixture.componentInstance.geometry()!;
    expect(el.querySelector('path.line')?.getAttribute('d')).toBe(g.linePath);
    expect(el.querySelector('path.area')?.getAttribute('d')).toBe(g.areaPath);
    expect(el.querySelector('path.comparison')?.getAttribute('d')).toBe(g.comparisonPath);
    // lacuna no dia 3: a linha atual tem dois trechos
    expect(g.linePath.match(/M/g)?.length).toBe(2);
  });

  it('resume o gráfico para leitores de tela', () => {
    const label = frame().getAttribute('aria-label') ?? '';
    expect(frame().getAttribute('role')).toBe('img');
    expect(label).toContain('Investimento de 01/11/2026 a 04/11/2026');
    expect(label).toContain('Mínimo R$ 100');
    expect(label).toContain('máximo R$ 250');
    expect(label).toContain('último R$ 180');
  });

  it('traz uma tabela oculta com todos os pontos', () => {
    const rows = el.querySelectorAll('table tbody tr');
    expect(rows.length).toBe(4);
    expect(rows[2].textContent).toContain('—');
    expect(rows[0].textContent).toContain('R$ 90');
  });

  it('mostra tooltip com as duas séries ao navegar pelo teclado', async () => {
    await key('ArrowRight');
    await key('ArrowRight');

    const tooltip = el.querySelector('.tooltip');
    expect(tooltip?.textContent).toContain('02/11/2026');
    expect(tooltip?.textContent).toContain('R$ 250');
    expect(tooltip?.textContent).toContain('R$ 120');
    expect(el.querySelector('[aria-live]')?.textContent).toContain('02/11/2026: R$ 250; Período anterior: R$ 120');

    await key('End');
    expect(el.querySelector('.tooltip')?.textContent).toContain('04/11/2026');

    await key('Escape');
    expect(el.querySelector('.tooltip')).toBeNull();
  });

  it('desenha marcos da linha do tempo e mostra o rótulo no dia (ponteiro ou teclado)', async () => {
    fixture.componentRef.setInput('markers', [
      { date: '2026-11-02', label: 'Campanha de Black Friday no ar' },
      { date: '2026-11-02', label: 'Novos criativos' },
      { date: '2026-12-25', label: 'Fora do período' },
    ]);
    await fixture.whenStable();

    const lines = el.querySelectorAll('line.marker');
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute('x1')).toBe(String(fixture.componentInstance.geometry()!.points[1].x));
    expect(frame().getAttribute('aria-label')).toContain('1 marco no período');
    expect(el.querySelector('table')?.textContent).toContain('Campanha de Black Friday no ar; Novos criativos');

    await key('Home');
    await key('ArrowRight');
    expect(el.querySelector('.tooltip')?.textContent).toContain('Campanha de Black Friday no ar');
    expect(el.querySelectorAll('.tip-marker')).toHaveLength(2);
    expect(el.querySelector('[aria-live]')?.textContent).toContain('Marco: Campanha de Black Friday no ar; Novos criativos');
  });

  it('mostra estado vazio sem dados', async () => {
    fixture.componentRef.setInput('series', []);
    await fixture.whenStable();
    expect(el.querySelector('svg')).toBeNull();
    expect(el.textContent).toContain('Sem dados no período');
  });
});
