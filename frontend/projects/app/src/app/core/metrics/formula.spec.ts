import {
  FormulaOption,
  completionFor,
  formulaHints,
  formulaReferences,
  insertAtCursor,
  replaceRange,
  suggestFormulaOptions,
  tokenizeFormula,
  wordAt,
} from './formula';

const KNOWN = new Set(['meta_ads:spend', 'meta_ads:conversion_value', 'google_ads:cost', 'custom:roas_total']);

describe('tokenizeFormula', () => {
  it('reproduz o texto exato e classifica cada trecho', () => {
    const source = 'sum(meta_ads:spend, google_ads:cost) / 2.5';
    const tokens = tokenizeFormula(source, KNOWN);

    expect(tokens.map((t) => t.text).join('')).toBe(source);
    expect(tokens.filter((t) => t.type !== 'space').map((t) => [t.type, t.text])).toEqual([
      ['function', 'sum'],
      ['paren', '('],
      ['ref', 'meta_ads:spend'],
      ['comma', ','],
      ['ref', 'google_ads:cost'],
      ['paren', ')'],
      ['operator', '/'],
      ['number', '2.5'],
    ]);
    expect(tokens.every((t) => source.slice(t.start, t.end) === t.text)).toBe(true);
  });

  it('marca referências e funções desconhecidas, inclusive incompletas', () => {
    const tokens = tokenizeFormula('media(meta_ads:inventada) + meta_ads: + custom:roas_total', KNOWN);
    const byText = new Map(tokens.map((t) => [t.text, t]));

    expect(byText.get('media')).toMatchObject({ type: 'function', known: false });
    expect(byText.get('meta_ads:inventada')).toMatchObject({ type: 'ref', known: false });
    expect(byText.get('meta_ads:')).toMatchObject({ type: 'ref', known: false });
    expect(byText.get('custom:roas_total')).toMatchObject({ type: 'ref', known: true });
  });

  it('isola caracteres fora da sintaxe', () => {
    const bad = tokenizeFormula('meta_ads:spend; drop').find((t) => t.type === 'unknown');
    expect(bad).toMatchObject({ text: ';', start: 14 });
  });
});

describe('formulaReferences', () => {
  it('lista cada referência uma vez, na ordem', () => {
    expect(formulaReferences('meta_ads:spend + google_ads:cost * meta_ads:spend')).toEqual([
      'meta_ads:spend',
      'google_ads:cost',
    ]);
  });
});

describe('formulaHints', () => {
  it('não reclama de fórmula válida nem vazia', () => {
    expect(formulaHints('sum(meta_ads:spend, google_ads:cost) / 2', KNOWN)).toEqual([]);
    expect(formulaHints('   ', KNOWN)).toEqual([]);
  });

  it('aponta parênteses, referências, funções e caracteres inválidos', () => {
    expect(formulaHints('(meta_ads:spend', KNOWN)).toContain('Falta fechar um parêntese.');
    expect(formulaHints('((meta_ads:spend', KNOWN)).toContain('Faltam fechar 2 parênteses.');
    expect(formulaHints('meta_ads:spend)', KNOWN)).toContain('Há um parêntese fechado sem abertura.');
    expect(formulaHints('meta_ads:x + ga4:y', KNOWN)).toContain('Referências desconhecidas: meta_ads:x, ga4:y');
    expect(formulaHints('media(meta_ads:spend)', KNOWN)[0]).toContain('Função desconhecida: media');
    expect(formulaHints('meta_ads:spend $ 2', KNOWN)).toContain('Caractere inesperado "$" na posição 16.');
  });
});

describe('edição no cursor', () => {
  it('encontra a palavra sendo digitada antes do cursor', () => {
    expect(wordAt('sum(meta_ads:sp', 15)).toEqual({ start: 4, end: 15, text: 'meta_ads:sp' });
    expect(wordAt('a:b + ', 6)).toBeNull();
    expect(wordAt('2 + 3', 1)).toBeNull();
  });

  it('insere operador com espaços nos dois lados', () => {
    expect(insertAtCursor('meta_ads:spend', 14, 14, { kind: 'operator', text: '/' })).toEqual({
      value: 'meta_ads:spend / ',
      caret: 17,
    });
  });

  it('insere referência no meio do texto, separada da palavra anterior', () => {
    const source = 'meta_ads:spend / ';
    expect(insertAtCursor(source, source.length, source.length, { kind: 'ref', text: 'google_ads:cost' })).toEqual({
      value: 'meta_ads:spend / google_ads:cost',
      caret: 32,
    });
    expect(insertAtCursor('sum()', 4, 4, { kind: 'ref', text: 'meta_ads:spend' })).toEqual({
      value: 'sum(meta_ads:spend)',
      caret: 18,
    });
  });

  it('abre a função com o cursor dentro, ou envolve a seleção', () => {
    expect(insertAtCursor('', 0, 0, { kind: 'function', text: 'sum' })).toEqual({ value: 'sum()', caret: 4 });
    const source = 'meta_ads:spend / 3';
    expect(insertAtCursor(source, 0, 18, { kind: 'function', text: 'round' })).toEqual({
      value: 'round(meta_ads:spend / 3)',
      caret: 25,
    });
  });

  it('troca a palavra pelo item escolhido no autocompletar', () => {
    const { text, caretOffset } = completionFor({ key: 'sum', label: 'sum(a, b, …)', group: 'Funções', kind: 'function' });
    expect(replaceRange('2 * su', 4, 6, text, caretOffset)).toEqual({ value: '2 * sum()', caret: 8 });
  });
});

describe('suggestFormulaOptions', () => {
  const options: FormulaOption[] = [
    { key: 'meta_ads:spend', label: 'Investimento', group: 'Meta Ads', kind: 'metric' },
    { key: 'google_ads:cost', label: 'Investimento', group: 'Google Ads', kind: 'metric' },
    { key: 'meta_ads:conversions', label: 'Conversões', group: 'Meta Ads', kind: 'metric' },
    { key: 'custom:roas_total', label: 'ROAS total', group: 'Indicadores', kind: 'custom' },
    { key: 'sum', label: 'sum(a, b, …)', group: 'Funções', kind: 'function' },
  ];

  it('prioriza chave que começa com o trecho, depois o nome curto e o rótulo', () => {
    expect(suggestFormulaOptions('meta_ads:co', options).map((o) => o.key)).toEqual(['meta_ads:conversions']);
    expect(suggestFormulaOptions('spe', options).map((o) => o.key)).toEqual(['meta_ads:spend']);
    expect(suggestFormulaOptions('invest', options).map((o) => o.key)).toEqual(['google_ads:cost', 'meta_ads:spend']);
  });

  it('ignora acentos e maiúsculas no rótulo', () => {
    expect(suggestFormulaOptions('CONVERSOES', options).map((o) => o.key)).toEqual(['meta_ads:conversions']);
  });

  it('acha funções e indicadores e respeita o limite', () => {
    expect(suggestFormulaOptions('su', options)[0].key).toBe('sum');
    expect(suggestFormulaOptions('roas', options).map((o) => o.key)).toEqual(['custom:roas_total']);
    expect(suggestFormulaOptions('a', options, 2)).toHaveLength(2);
    expect(suggestFormulaOptions('', options)).toEqual([]);
  });
});
