/**
 * Fórmulas de indicadores personalizados — análise no cliente.
 *
 * Só para ajudar quem digita (realce, autocompletar, dicas). Quem valida de verdade é o backend:
 * a sintaxe aceita aqui espelha a dele, mas a mensagem 422 do servidor sempre prevalece.
 *
 * Sintaxe: referências `plataforma:metrica` e `custom:slug`; + - * / e parênteses; números com
 * ponto decimal; funções sum, min, max, abs, round, coalesce. Máximo de 500 caracteres.
 */

export const FORMULA_MAX_LENGTH = 500;

export interface FormulaFunction {
  name: string;
  signature: string;
  description: string;
}

export const FORMULA_FUNCTIONS: readonly FormulaFunction[] = [
  { name: 'sum', signature: 'sum(a, b, …)', description: 'Soma, ignorando valores ausentes' },
  { name: 'min', signature: 'min(a, b, …)', description: 'Menor valor, ignorando ausentes' },
  { name: 'max', signature: 'max(a, b, …)', description: 'Maior valor, ignorando ausentes' },
  { name: 'abs', signature: 'abs(x)', description: 'Valor absoluto' },
  { name: 'round', signature: 'round(x, casas)', description: 'Arredonda com 0 a 6 casas' },
  { name: 'coalesce', signature: 'coalesce(a, b, …)', description: 'Primeiro valor presente' },
];

const FUNCTION_NAMES = new Set(FORMULA_FUNCTIONS.map((f) => f.name));

export type FormulaTokenType =
  | 'ref'
  | 'function'
  | 'number'
  | 'operator'
  | 'paren'
  | 'comma'
  | 'space'
  | 'unknown';

export interface FormulaToken {
  type: FormulaTokenType;
  text: string;
  start: number;
  end: number;
  /** Para ref/function: existe no catálogo / é uma função conhecida. */
  known?: boolean;
}

const REF = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*/;
const WORD = /^[a-z][a-z0-9_]*:?[a-z0-9_]*/;
const NUMBER = /^\d+(?:\.\d+)?/;

/** Quebra a fórmula em tokens, sem perder nenhum caractere (o realce reproduz o texto exato). */
export function tokenizeFormula(source: string, knownKeys?: ReadonlySet<string>): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let i = 0;

  while (i < source.length) {
    const rest = source.slice(i);
    const char = source[i];
    let type: FormulaTokenType;
    let text: string;
    let known: boolean | undefined;

    if (/\s/.test(char)) {
      text = /^\s+/.exec(rest)![0];
      type = 'space';
    } else if ('+-*/'.includes(char)) {
      text = char;
      type = 'operator';
    } else if (char === '(' || char === ')') {
      text = char;
      type = 'paren';
    } else if (char === ',') {
      text = char;
      type = 'comma';
    } else if (NUMBER.test(rest)) {
      text = NUMBER.exec(rest)![0];
      type = 'number';
    } else if (REF.test(rest)) {
      text = REF.exec(rest)![0];
      type = 'ref';
      known = knownKeys ? knownKeys.has(text) : undefined;
    } else if (WORD.test(rest)) {
      text = WORD.exec(rest)![0];
      if (!text.includes(':')) {
        type = 'function';
        known = FUNCTION_NAMES.has(text);
      } else {
        // "meta_ads:" ainda sendo digitado
        type = 'ref';
        known = false;
      }
    } else {
      text = char;
      type = 'unknown';
    }

    tokens.push({ type, text, start: i, end: i + text.length, ...(known === undefined ? {} : { known }) });
    i += text.length;
  }

  return tokens;
}

/** Referências (sem repetição, na ordem em que aparecem). */
export function formulaReferences(source: string): string[] {
  return [...new Set(tokenizeFormula(source).filter((t) => t.type === 'ref').map((t) => t.text))];
}

/** Dicas locais. Não bloqueiam o salvamento: o backend decide. */
export function formulaHints(source: string, knownKeys: ReadonlySet<string>): string[] {
  const trimmed = source.trim();
  if (!trimmed) return [];

  const hints: string[] = [];
  const tokens = tokenizeFormula(source, knownKeys);

  if (source.length > FORMULA_MAX_LENGTH) {
    hints.push(`A fórmula passou de ${FORMULA_MAX_LENGTH} caracteres.`);
  }

  let depth = 0;
  for (const t of tokens) {
    if (t.text === '(') depth++;
    if (t.text === ')') depth--;
    if (depth < 0) break;
  }
  if (depth > 0) hints.push(depth === 1 ? 'Falta fechar um parêntese.' : `Faltam fechar ${depth} parênteses.`);
  if (depth < 0) hints.push('Há um parêntese fechado sem abertura.');

  const unknownRefs = [...new Set(tokens.filter((t) => t.type === 'ref' && t.known === false).map((t) => t.text))];
  if (unknownRefs.length) {
    hints.push(
      unknownRefs.length === 1
        ? `Referência desconhecida: ${unknownRefs[0]}`
        : `Referências desconhecidas: ${unknownRefs.join(', ')}`,
    );
  }

  const unknownFns = [...new Set(tokens.filter((t) => t.type === 'function' && !t.known).map((t) => t.text))];
  if (unknownFns.length) {
    hints.push(`Função desconhecida: ${unknownFns.join(', ')}. Disponíveis: ${[...FUNCTION_NAMES].join(', ')}.`);
  }

  const bad = tokens.find((t) => t.type === 'unknown');
  if (bad) hints.push(`Caractere inesperado "${bad.text}" na posição ${bad.start + 1}.`);

  return hints;
}

/* ---------- Edição no cursor ---------- */

export interface EditResult {
  value: string;
  /** Posição do cursor depois da edição. */
  caret: number;
}

/** Palavra (referência ou função) sendo digitada imediatamente antes do cursor. */
export function wordAt(source: string, caret: number): { start: number; end: number; text: string } | null {
  let start = caret;
  while (start > 0 && /[a-z0-9_:]/i.test(source[start - 1])) start--;
  let end = caret;
  while (end < source.length && /[a-z0-9_:]/i.test(source[end])) end++;
  const text = source.slice(start, caret);
  if (!text || !/^[a-z]/i.test(text)) return null;
  return { start, end, text };
}

/** Substitui a palavra em [start, end) pelo texto escolhido no autocompletar. */
export function replaceRange(source: string, start: number, end: number, text: string, caretOffset = text.length): EditResult {
  return { value: source.slice(0, start) + text + source.slice(end), caret: start + caretOffset };
}

/**
 * Insere um trecho no cursor, com espaçamento natural:
 *  - operadores ganham espaço dos dois lados ("a + b");
 *  - funções abrem "nome(" e, se houver seleção, envolvem o trecho selecionado;
 *  - referências e números se separam da palavra anterior por espaço.
 */
export function insertAtCursor(
  source: string,
  selectionStart: number,
  selectionEnd: number,
  insert: { kind: 'ref' | 'operator' | 'function' | 'paren' | 'comma'; text: string },
): EditResult {
  const before = source.slice(0, selectionStart);
  const selected = source.slice(selectionStart, selectionEnd);
  const after = source.slice(selectionEnd);
  const prev = before.at(-1) ?? '';
  const next = after[0] ?? '';
  const needsSpaceBefore = prev !== '' && !/[\s(]/.test(prev);

  let text: string;
  let caret: number;

  switch (insert.kind) {
    case 'operator': {
      text = `${needsSpaceBefore ? ' ' : ''}${insert.text}${next === ' ' ? '' : ' '}`;
      caret = text.length;
      break;
    }
    case 'function': {
      const lead = needsSpaceBefore ? ' ' : '';
      text = `${lead}${insert.text}(${selected})`;
      // com seleção: cursor depois do ")"; sem seleção: dentro dos parênteses
      caret = selected ? text.length : lead.length + insert.text.length + 1;
      break;
    }
    case 'comma': {
      text = `, `;
      caret = text.length;
      break;
    }
    case 'paren': {
      text = insert.text;
      caret = text.length;
      break;
    }
    default: {
      const lead = needsSpaceBefore && prev !== '(' ? ' ' : '';
      text = `${lead}${insert.text}`;
      caret = text.length;
    }
  }

  return { value: before + text + after, caret: before.length + caret };
}

/* ---------- Autocompletar ---------- */

export type FormulaOptionKind = 'metric' | 'custom' | 'function';

export interface FormulaOption {
  /** Texto inserido (chave da métrica ou nome da função). */
  key: string;
  label: string;
  /** Agrupamento visível (ex.: "Meta Ads", "Indicadores", "Funções"). */
  group: string;
  kind: FormulaOptionKind;
  detail?: string;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Sugestões para o trecho digitado: primeiro chaves que começam com ele, depois rótulos que o contêm
 * (sem acento e sem diferenciar maiúsculas). "spend", "investimento" e "meta_ads:sp" acham meta_ads:spend.
 */
export function suggestFormulaOptions(prefix: string, options: readonly FormulaOption[], limit = 8): FormulaOption[] {
  const q = normalize(prefix.trim());
  if (!q) return [];

  const scored: { option: FormulaOption; score: number }[] = [];
  for (const option of options) {
    const key = normalize(option.key);
    const name = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
    const label = normalize(option.label);
    let score = -1;
    if (key.startsWith(q)) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (label.startsWith(q)) score = 2;
    else if (label.includes(q) || key.includes(q)) score = 3;
    if (score >= 0) scored.push({ option, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.option.key.localeCompare(b.option.key))
    .slice(0, limit)
    .map((s) => s.option);
}

/** Texto e deslocamento do cursor ao aceitar uma sugestão (funções já abrem o parêntese). */
export function completionFor(option: FormulaOption): { text: string; caretOffset: number } {
  return option.kind === 'function'
    ? { text: `${option.key}()`, caretOffset: option.key.length + 1 }
    : { text: option.key, caretOffset: option.key.length };
}
