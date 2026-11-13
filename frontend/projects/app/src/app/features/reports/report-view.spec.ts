import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReportData } from '../../core/api/api.types';
import { REPORT_DATA } from './report-fixtures';
import { changeText, ReportView } from './report-view';

describe('changeText', () => {
  it('formata a variação com seta e uma casa', () => {
    expect(changeText(12.5)).toBe('▲ 12,5%');
    expect(changeText(-6)).toBe('▼ 6,0%');
    expect(changeText(0)).toBe('= 0,0%');
    expect(changeText(null)).toBe('—');
  });
});

describe('ReportView', () => {
  let fixture: ComponentFixture<ReportView>;
  let el: HTMLElement;

  async function render(data: ReportData = REPORT_DATA, selectable = false): Promise<void> {
    fixture = TestBed.createComponent(ReportView);
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('selectable', selectable);
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  }
  const block = (id: string) => el.querySelector<HTMLElement>(`[data-block="${id}"]`)!;

  it('mostra a capa com agência, projeto, período e comparação', async () => {
    await render();
    const cover = el.querySelector('.cover')!.textContent!;
    expect(cover).toContain('Agência Norte');
    expect(cover).toContain('Relatório de outubro');
    expect(cover).toContain('Padaria Aurora');
    expect(cover).toContain('01/10/2026 – 31/10/2026');
    expect(cover).toContain('comparado a 31/08/2026 – 30/09/2026');
  });

  it('renderiza o texto com segurança: negrito, quebras, listas e HTML escapado', async () => {
    await render();
    const text = block('b1').querySelector('.text')!;
    expect(text.querySelector('strong')?.textContent).toBe('Ótimo mês!');
    expect(text.querySelector('script')).toBeNull();
    expect(text.textContent).toContain('<script>alert(1)</script>');
    expect(text.querySelectorAll('br').length).toBe(1);
    expect([...text.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual(['item A', 'item B']);
  });

  it('KPIs com canal quando o bloco mistura canais, e vazio quando não há conta', async () => {
    await render();
    const labels = [...block('b2').querySelectorAll('ds-kpi-tile .label')].map((l) => l.textContent?.trim());
    expect(labels).toEqual(['Investimento · Meta Ads', 'Alcance · Instagram']);
    expect(block('b2').querySelector('ds-status-badge')).not.toBeNull();
    expect(block('b6').textContent).toContain('Sem dados: conecte as contas deste canal ao projeto.');
  });

  it('gráfico, tabela com variação colorida e sinais de atenção', async () => {
    await render();
    expect(block('b4').querySelector('.chart-title')?.textContent).toContain('Conversões');
    expect(block('b4').querySelector('ds-area-chart')).not.toBeNull();

    const row = block('b5').querySelector('tbody tr')!;
    expect(row.textContent).toContain('CPM');
    expect(row.querySelector('.change')?.textContent).toBe('▼ 1,2%');
    expect(row.querySelector('.change')?.getAttribute('data-sentiment')).toBe('positive');
    expect(block('b5').querySelectorAll('thead th').length).toBe(4);

    expect(block('b3').querySelector('.signal')?.getAttribute('data-status')).toBe('critical');
    expect(block('b3').textContent).toContain('Revise as campanhas.');
    expect(block('b7').textContent).toContain('Nenhum ponto de atenção no período');
  });

  it('sem comparação, a tabela some com anterior/variação', async () => {
    await render({ ...REPORT_DATA, compare: 'none', comparison: null });
    expect(block('b5').querySelectorAll('thead th').length).toBe(2);
    expect(el.querySelector('.cover')!.textContent).not.toContain('comparado a');
  });

  it('no montador, clicar num bloco seleciona e os incompletos aparecem como pendentes', async () => {
    await render(REPORT_DATA, true);
    fixture.componentRef.setInput('pending', { s2: [{ id: 'b9', type: 'chart', message: 'Escolha a métrica do gráfico.' }] });
    fixture.componentRef.setInput('selectedId', 'b5');
    await fixture.whenStable();

    const picked: string[] = [];
    fixture.componentInstance.blockSelect.subscribe((id) => picked.push(id));
    block('b4').click();
    block('b9').click();

    expect(picked).toEqual(['b4', 'b9']);
    expect(block('b5').classList).toContain('is-selected');
    expect(block('b9').textContent).toContain('Escolha a métrica do gráfico.');
  });

  it('fora do montador, nada é selecionável', async () => {
    await render();
    const picked: string[] = [];
    fixture.componentInstance.blockSelect.subscribe((id) => picked.push(id));
    block('b4').click();
    expect(picked).toEqual([]);
    expect(block('b4').getAttribute('role')).toBeNull();
  });
});
