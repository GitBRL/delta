import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormulaOption } from '../../core/metrics/formula';
import { FormulaField } from './formula-field';

const OPTIONS: FormulaOption[] = [
  { key: 'meta_ads:spend', label: 'Investimento', group: 'Meta Ads', kind: 'metric' },
  { key: 'meta_ads:conversion_value', label: 'Valor de conversão', group: 'Meta Ads', kind: 'metric' },
  { key: 'google_ads:cost', label: 'Investimento', group: 'Google Ads', kind: 'metric' },
  { key: 'sum', label: 'sum(a, b, …)', group: 'Funções', kind: 'function' },
];

describe('FormulaField', () => {
  let fixture: ComponentFixture<FormulaField>;
  let el: HTMLElement;
  let area: HTMLTextAreaElement;

  async function setup(value = '', extra: Record<string, unknown> = {}): Promise<void> {
    fixture = TestBed.createComponent(FormulaField);
    fixture.componentRef.setInput('options', OPTIONS);
    fixture.componentRef.setInput('value', value);
    for (const [k, v] of Object.entries(extra)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
    area = el.querySelector('textarea')!;
  }

  const button = (text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;

  async function type(text: string, caret = text.length): Promise<void> {
    area.value = text;
    area.setSelectionRange(caret, caret);
    area.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  it('insere operador e referência no cursor, com espaçamento', async () => {
    await setup('meta_ads:conversion_value');
    area.setSelectionRange(area.value.length, area.value.length);

    el.querySelector<HTMLButtonElement>('button[aria-label="Dividir"]')!.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('meta_ads:conversion_value / ');

    // paleta "Meta Ads": chip "Investimento"
    button('Investimento').click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('meta_ads:conversion_value / meta_ads:spend');
    expect(area.selectionStart).toBe(area.value.length);
  });

  it('abre função com o cursor entre os parênteses e troca de plataforma na paleta', async () => {
    await setup('');
    button('sum()').click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('sum()');
    expect(area.selectionStart).toBe(4);

    button('Google Ads').click();
    await fixture.whenStable();
    button('Investimento').click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('sum(google_ads:cost)');
  });

  it('autocompleta pelo rótulo em pt-BR e aceita com o teclado', async () => {
    await setup('');
    await type('2 * invest');

    const options = [...el.querySelectorAll('[role=option]')];
    expect(options.map((o) => o.querySelector('.s-key')?.textContent)).toEqual(['google_ads:cost', 'meta_ads:spend']);
    expect(area.getAttribute('aria-expanded')).toBe('true');

    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    await fixture.whenStable();
    expect(options[1].getAttribute('aria-selected')).toBe('true');

    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('2 * meta_ads:spend');
    expect(el.querySelector('[role=listbox]')).toBeNull();
  });

  it('realça referência desconhecida e mostra dicas locais', async () => {
    await setup('meta_ads:inventada + (meta_ads:spend');

    const bad = el.querySelector('.highlight .bad');
    expect(bad?.textContent).toBe('meta_ads:inventada');
    const hints = [...el.querySelectorAll('.hint')].map((h) => h.textContent?.trim());
    expect(hints).toContain('Falta fechar um parêntese.');
    expect(hints).toContain('Referência desconhecida: meta_ads:inventada');
  });

  it('exibe o erro do backend e marca o campo como inválido', async () => {
    await setup('meta_ads:spend +', { error: 'A fórmula termina de forma incompleta.' });

    expect(el.querySelector('.server-error')?.textContent?.trim()).toBe('A fórmula termina de forma incompleta.');
    expect(area.getAttribute('aria-invalid')).toBe('true');
    // o texto digitado continua lá
    expect(area.value).toBe('meta_ads:spend +');
  });

  it('em modo leitura não oferece ferramentas nem sugestões', async () => {
    await setup('meta_ads:spend', { readonly: true });

    expect(area.readOnly).toBe(true);
    expect(el.querySelector('[role=toolbar]')).toBeNull();
    await type('invest');
    expect(el.querySelector('[role=listbox]')).toBeNull();
  });
});
