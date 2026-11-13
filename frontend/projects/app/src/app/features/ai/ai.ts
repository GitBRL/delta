import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import {
  API,
  AiSettingsBody,
  AiStatus,
  ApiEnvelope,
  LayoutBlock,
  ReportLayout,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors, validationMessage } from '../../core/forms/server-errors';
import { REPORT_LIMITS, createSection } from '../../core/reports/report-layout';
import { TenantService } from '../../core/tenant/tenant.service';

/* ---------- Estado do copiloto (compartilhado entre telas) ---------- */

/**
 * Status do copiloto da agência atual (equipe). Uma busca por agência, reaproveitada pelo editor
 * de relatório, pelo projeto e pela tela de configuração (que atualiza o valor depois de salvar).
 */
@Injectable({ providedIn: 'root' })
export class AiStatusStore {
  private readonly tenant = inject(TenantService);

  readonly resource = httpResource<ApiEnvelope<AiStatus>>(() => {
    const current = this.tenant.current();
    return current && current.role !== 'client' ? { url: API.ai, headers: { [TENANT_HEADER]: current.id } } : undefined;
  });

  readonly status = computed<AiStatus | null>(() => (this.resource.hasValue() ? this.resource.value().data : null));
  readonly loading = computed(() => this.resource.isLoading() && !this.resource.hasValue());
  readonly failed = computed(() => !!this.resource.error() && !this.resource.hasValue());

  set(status: AiStatus): void {
    this.resource.set({ data: status });
  }

  reload(): void {
    this.resource.reload();
  }
}

/** Pronto para uso: ligado e com chave (da agência ou do servidor). */
export function aiReady(status: AiStatus | null): boolean {
  return !!status && status.enabled && status.configured;
}

/** Por que o copiloto não está disponível (para o estado vazio). */
export function aiUnavailableText(status: AiStatus): string {
  if (!status.configured) return 'O copiloto de IA ainda não tem uma chave cadastrada nesta agência.';
  if (!status.enabled) return 'O copiloto de IA está desligado nesta agência.';
  return 'O orçamento de IA da agência para este mês acabou.';
}

/* ---------- Erros ---------- */

/** Mensagem pronta para exibir quando o copiloto não responde. */
export function aiErrorMessage(error: unknown): string {
  const fields = extractFieldErrors(error);
  if (fields) {
    return fields['ai'] ?? fields['question'] ?? Object.values(fields)[0] ?? validationMessage(error) ?? 'O copiloto não conseguiu responder.';
  }
  if (error instanceof HttpErrorResponse && error.status === 429) {
    return 'Muitos pedidos seguidos ao copiloto. Espere um minuto e tente de novo.';
  }
  return 'Não foi possível falar com o copiloto agora. Tente de novo em instantes.';
}

/* ---------- Orçamento ---------- */

export const AI_BUDGET = { min: 10_000, max: 500_000_000, default: 2_000_000 } as const;

const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** "2.000.000" */
export function formatTokens(value: number): string {
  return INT.format(value);
}

/** Uso do mês: percentual (0–100, limitado) e tom da barra. */
export function aiUsage(status: Pick<AiStatus, 'budget' | 'used_this_month'>): { pct: number; tone: 'ok' | 'warn' | 'over' } {
  const ratio = status.budget > 0 ? status.used_this_month / status.budget : 1;
  const pct = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  return { pct, tone: ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok' };
}

export interface AiSettingsDraft {
  api_key: string;
  enabled: boolean;
  /** Texto do campo (aceita "2.000.000"). */
  budget: string;
}

export function aiDraftFrom(status: AiStatus): AiSettingsDraft {
  return { api_key: '', enabled: status.enabled, budget: String(status.budget) };
}

/** "2.000.000" → 2000000; vazio ou inválido → NaN. */
export function parseTokens(text: string): number {
  const digits = text.replace(/[\s.]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : Number.NaN;
}

export function validateAiSettings(draft: AiSettingsDraft): FieldErrors {
  const errors: FieldErrors = {};
  const key = draft.api_key.trim();
  if (key && /\s/.test(key)) errors['api_key'] = 'A chave não tem espaços. Copie de novo do console da Anthropic.';
  else if (key && key.length < 20) errors['api_key'] = 'A chave parece incompleta. Copie de novo do console da Anthropic.';

  const budget = parseTokens(draft.budget);
  if (!Number.isFinite(budget)) errors['monthly_token_budget'] = 'Informe o orçamento em tokens (só números).';
  else if (budget < AI_BUDGET.min || budget > AI_BUDGET.max) {
    errors['monthly_token_budget'] = `Use entre ${formatTokens(AI_BUDGET.min)} e ${formatTokens(AI_BUDGET.max)} tokens.`;
  }
  return errors;
}

export function aiSettingsBody(draft: AiSettingsDraft): AiSettingsBody {
  const body: AiSettingsBody = { enabled: draft.enabled, monthly_token_budget: parseTokens(draft.budget) };
  const key = draft.api_key.trim();
  if (key) body.api_key = key;
  return body;
}

/* ---------- Análise no relatório ---------- */

export const ANALYSIS_TITLE = 'Análise da agência';

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

/** Bloco de texto de análise (o dos modelos se chama "Análise da agência"). */
export function isAnalysisBlock(block: LayoutBlock): boolean {
  return block.type === 'text' && normalize(block.title ?? '').startsWith('analise');
}

/**
 * Coloca a análise no relatório: substitui o texto do bloco de análise, se houver; senão, cria um
 * no topo da primeira seção (ou numa seção nova). `null` se o relatório já está no limite.
 */
export function insertAnalysis(
  layout: ReportLayout,
  text: string,
  newId: () => string = () => `b_${Math.random().toString(36).slice(2, 10)}`,
): { layout: ReportLayout; blockId: string; replaced: boolean } | null {
  const content = text.trim().slice(0, REPORT_LIMITS.text);

  for (const section of layout.sections) {
    const existing = section.blocks.find(isAnalysisBlock);
    if (existing) {
      return {
        replaced: true,
        blockId: existing.id,
        layout: {
          sections: layout.sections.map((s) => ({
            ...s,
            blocks: s.blocks.map((b) => (b.id === existing.id && b.type === 'text' ? { ...b, content } : b)),
          })),
        },
      };
    }
  }

  const block: LayoutBlock = { id: newId(), type: 'text', title: ANALYSIS_TITLE, content };
  const [first, ...rest] = layout.sections;
  if (first && first.blocks.length < REPORT_LIMITS.blocks) {
    return { replaced: false, blockId: block.id, layout: { sections: [{ ...first, blocks: [block, ...first.blocks] }, ...rest] } };
  }
  if (layout.sections.length >= REPORT_LIMITS.sections) return null;

  const section = { ...createSection(first ? 'Análise' : 'Resumo do período'), blocks: [block] };
  return { replaced: false, blockId: block.id, layout: { sections: [section, ...layout.sections] } };
}

/** Perguntas de exemplo do copiloto no projeto. */
export const ASK_EXAMPLES: readonly string[] = [
  'O que mais mudou nos últimos 30 dias?',
  'Onde o custo por resultado está pior?',
  'O que devo priorizar esta semana?',
];

export const ASK_LIMITS = { min: 3, max: 500 } as const;
