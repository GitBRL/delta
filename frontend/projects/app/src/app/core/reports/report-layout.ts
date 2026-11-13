import {
  CompareMode,
  DateRange,
  LayoutBlock,
  LayoutSection,
  ReportBlockType,
  ReportLayout,
  ReportPeriodPreset,
  SaveReportBody,
} from '../api/api.types';
import { FieldErrors } from '../forms/server-errors';

/** Limites do backend (App\Domain\Reports\ReportLayout). */
export const REPORT_LIMITS = {
  sections: 30,
  blocks: 30,
  kpis: 12,
  table: 20,
  text: 5000,
  title: 80,
  reportTitle: 120,
  attentionMax: 10,
} as const;

export interface BlockTypeInfo {
  type: ReportBlockType;
  label: string;
  description: string;
}

export const BLOCK_TYPES: readonly BlockTypeInfo[] = [
  { type: 'kpis', label: 'KPIs', description: 'Grade de indicadores com variação e semáforo' },
  { type: 'chart', label: 'Gráfico', description: 'Evolução diária de uma métrica, com a comparação' },
  { type: 'table', label: 'Tabela', description: 'Valor, anterior e variação de várias métricas' },
  { type: 'text', label: 'Texto', description: 'Análise escrita pela agência' },
  { type: 'attention', label: 'Atenção', description: 'Pontos de atenção e sugestões do semáforo' },
];

export function blockTypeLabel(type: ReportBlockType): string {
  return BLOCK_TYPES.find((b) => b.type === type)?.label ?? type;
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Id curto e válido para o backend (/^[A-Za-z0-9_-]{1,40}$/). */
export function newId(prefix: 's' | 'b'): string {
  let id = prefix;
  for (let i = 0; i < 8; i++) id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return id;
}

export function createBlock(type: ReportBlockType): LayoutBlock {
  const id = newId('b');
  switch (type) {
    case 'kpis':
      return { id, type, metrics: [] };
    case 'table':
      return { id, type, metrics: [] };
    case 'chart':
      return { id, type, metric: '' };
    case 'text':
      return { id, type, content: '' };
    case 'attention':
      return { id, type, title: 'Pontos de atenção e sugestões', limit: 5 };
  }
}

export function createSection(title = 'Nova seção'): LayoutSection {
  return { id: newId('s'), title, blocks: [] };
}

export interface BlockLocation {
  section: LayoutSection;
  sectionIndex: number;
  block: LayoutBlock;
  blockIndex: number;
}

export function findBlock(layout: ReportLayout, blockId: string): BlockLocation | null {
  for (const [sectionIndex, section] of layout.sections.entries()) {
    const blockIndex = section.blocks.findIndex((b) => b.id === blockId);
    if (blockIndex >= 0) return { section, sectionIndex, block: section.blocks[blockIndex], blockIndex };
  }
  return null;
}

/* ---------- Operações imutáveis ---------- */

export function addSection(layout: ReportLayout, section: LayoutSection = createSection()): ReportLayout {
  return { sections: [...layout.sections, section] };
}

export function updateSection(layout: ReportLayout, sectionId: string, patch: Partial<Omit<LayoutSection, 'id'>>): ReportLayout {
  return { sections: layout.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)) };
}

export function removeSection(layout: ReportLayout, sectionId: string): ReportLayout {
  return { sections: layout.sections.filter((s) => s.id !== sectionId) };
}

export function moveSection(layout: ReportLayout, sectionId: string, delta: -1 | 1): ReportLayout {
  const index = layout.sections.findIndex((s) => s.id === sectionId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= layout.sections.length) return layout;
  const sections = [...layout.sections];
  [sections[index], sections[target]] = [sections[target], sections[index]];
  return { sections };
}

export function addBlock(layout: ReportLayout, sectionId: string, block: LayoutBlock): ReportLayout {
  return {
    sections: layout.sections.map((s) => (s.id === sectionId ? { ...s, blocks: [...s.blocks, block] } : s)),
  };
}

export function updateBlock(layout: ReportLayout, blockId: string, patch: Partial<LayoutBlock>): ReportLayout {
  return {
    sections: layout.sections.map((s) => ({
      ...s,
      blocks: s.blocks.map((b) => (b.id === blockId ? ({ ...b, ...patch, id: b.id, type: b.type } as LayoutBlock) : b)),
    })),
  };
}

export function removeBlock(layout: ReportLayout, blockId: string): ReportLayout {
  return { sections: layout.sections.map((s) => ({ ...s, blocks: s.blocks.filter((b) => b.id !== blockId) })) };
}

/**
 * Move o bloco dentro da seção; na borda, passa para a seção vizinha
 * (final da anterior ao subir, início da próxima ao descer).
 */
export function moveBlock(layout: ReportLayout, blockId: string, delta: -1 | 1): ReportLayout {
  const at = findBlock(layout, blockId);
  if (!at) return layout;
  const sections = layout.sections.map((s) => ({ ...s, blocks: [...s.blocks] }));
  const blocks = sections[at.sectionIndex].blocks;
  const target = at.blockIndex + delta;

  if (target >= 0 && target < blocks.length) {
    [blocks[at.blockIndex], blocks[target]] = [blocks[target], blocks[at.blockIndex]];
    return { sections };
  }

  const neighbor = sections[at.sectionIndex + delta];
  if (!neighbor) return layout;
  blocks.splice(at.blockIndex, 1);
  if (delta < 0) neighbor.blocks.push(at.block);
  else neighbor.blocks.unshift(at.block);
  return { sections };
}

export function canMoveBlock(layout: ReportLayout, blockId: string, delta: -1 | 1): boolean {
  const at = findBlock(layout, blockId);
  if (!at) return false;
  const target = at.blockIndex + delta;
  return (target >= 0 && target < at.section.blocks.length) || !!layout.sections[at.sectionIndex + delta];
}

/* ---------- Validação (mesmas regras do backend) ---------- */

/** Problemas por id de seção/bloco. Vazio = pode salvar. */
export function validateLayout(layout: ReportLayout): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const section of layout.sections) {
    if (!section.title.trim()) errors[section.id] = 'Dê um título para a seção.';
    for (const block of section.blocks) {
      const message = blockProblem(block);
      if (message) errors[block.id] = message;
    }
  }
  return errors;
}

export function blockProblem(block: LayoutBlock): string | null {
  switch (block.type) {
    case 'kpis':
    case 'table': {
      const max = block.type === 'kpis' ? REPORT_LIMITS.kpis : REPORT_LIMITS.table;
      if (block.metrics.length === 0) return 'Escolha ao menos uma métrica.';
      if (block.metrics.length > max) return `Este bloco aceita no máximo ${max} métricas.`;
      return null;
    }
    case 'chart':
      return block.metric ? null : 'Escolha a métrica do gráfico.';
    case 'text':
      return block.content.length > REPORT_LIMITS.text
        ? `O texto pode ter no máximo ${REPORT_LIMITS.text} caracteres.`
        : null;
    case 'attention':
      return null;
  }
}

/**
 * Layout para a PRÉVIA: blocos ainda incompletos ficam de fora (para o resto continuar
 * aparecendo) e seções sem título ganham um provisório.
 */
export function previewLayout(layout: ReportLayout): ReportLayout {
  return {
    sections: layout.sections.map((s) => ({
      ...s,
      title: s.title.trim() || 'Seção sem título',
      blocks: s.blocks
        .filter((b) => blockProblem(b) === null)
        .map((b) => (b.type === 'text' ? { ...b, content: b.content.slice(0, REPORT_LIMITS.text) } : b)),
    })),
  };
}

/** Blocos fora da prévia (incompletos), por seção, com o motivo. */
export function pendingBlocks(layout: ReportLayout): Record<string, { id: string; type: ReportBlockType; message: string }[]> {
  const pending: Record<string, { id: string; type: ReportBlockType; message: string }[]> = {};
  for (const section of layout.sections) {
    for (const block of section.blocks) {
      const message = blockProblem(block);
      if (message) (pending[section.id] ??= []).push({ id: block.id, type: block.type, message });
    }
  }
  return pending;
}

/**
 * Erros 422 do PUT → por id (seção/bloco) e gerais (título, período...).
 * Chaves do backend: "layout.sections.{s}.title", "layout.sections.{s}.blocks.{b}.{campo}".
 */
export function mapLayoutErrors(
  errors: FieldErrors,
  layout: ReportLayout,
): { byId: Record<string, string>; general: FieldErrors } {
  const byId: Record<string, string> = {};
  const general: FieldErrors = {};
  for (const [key, message] of Object.entries(errors)) {
    const block = /^layout\.sections\.(\d+)\.blocks\.(\d+)/.exec(key);
    const section = /^layout\.sections\.(\d+)/.exec(key);
    if (block) {
      const id = layout.sections[Number(block[1])]?.blocks[Number(block[2])]?.id;
      if (id) {
        byId[id] ??= message;
        continue;
      }
    } else if (section) {
      const id = layout.sections[Number(section[1])]?.id;
      if (id) {
        byId[id] ??= message;
        continue;
      }
    }
    general[key.startsWith('layout') ? 'layout' : key] ??= message;
  }
  return { byId, general };
}

/* ---------- Corpo de salvar / comparar ---------- */

export interface ReportDraft {
  title: string;
  preset: ReportPeriodPreset;
  custom: DateRange;
  compare: CompareMode;
  layout: ReportLayout;
}

export function saveBody(draft: ReportDraft): SaveReportBody {
  const custom = draft.preset === 'custom';
  return {
    title: draft.title.trim(),
    period_preset: draft.preset,
    period_start: custom ? draft.custom.start : null,
    period_end: custom ? draft.custom.end : null,
    compare: draft.compare,
    layout: draft.layout,
  };
}

/** Assinatura estável do que seria salvo (para "alterações não salvas"). */
export function draftSignature(draft: ReportDraft): string {
  return JSON.stringify(saveBody(draft));
}

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** "Relatório de outubro" a partir do fim do período (YYYY-MM-DD). */
export function suggestedTitle(periodEnd: string | null | undefined): string {
  const month = periodEnd ? Number(periodEnd.slice(5, 7)) : NaN;
  return Number.isInteger(month) && month >= 1 && month <= 12 ? `Relatório de ${MONTHS[month - 1]}` : 'Relatório';
}
