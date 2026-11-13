/**
 * Texto de análise do relatório → estrutura para o template (nunca HTML).
 * Mesmas regras do backend (App\Domain\Reports\Pdf\TextBlock):
 *  - linha em branco separa parágrafos;
 *  - bloco em que TODAS as linhas começam com "- " (ou "• ") vira lista;
 *  - **trecho** vira negrito; quebras simples viram <br>.
 * Como o template só interpola texto, qualquer HTML digitado aparece escapado.
 */

export interface TextSegment {
  text: string;
  bold: boolean;
}

/** Uma linha = sequência de trechos (normais ou em negrito). */
export type TextLine = TextSegment[];

export type TextNode = { kind: 'p'; lines: TextLine[] } | { kind: 'ul'; items: TextLine[] };

const LIST_ITEM = /^\s*[-•]\s+/;

export function parseReportText(text: string): TextNode[] {
  const trimmed = text.replace(/\r\n/g, '\n').trim();
  if (!trimmed) return [];

  return trimmed.split(/\n\s*\n/).map((chunk) => {
    const lines = chunk.split('\n');
    if (lines.every((line) => LIST_ITEM.test(line))) {
      return { kind: 'ul', items: lines.map((line) => inline(line.replace(LIST_ITEM, ''))) };
    }
    return { kind: 'p', lines: lines.map(inline) };
  });
}

/** "**a** b" → [{a, bold}, {" b"}]. Asteriscos sem par ficam como texto. */
export function inline(line: string): TextLine {
  const segments: TextLine = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: line.slice(last, index), bold: false });
    segments.push({ text: match[1], bold: true });
    last = index + match[0].length;
  }
  if (last < line.length) segments.push({ text: line.slice(last), bold: false });
  return segments.length ? segments : [{ text: '', bold: false }];
}
