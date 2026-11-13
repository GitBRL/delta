import { AttentionSignal } from '../api/api.types';
import {
  AttentionService,
  breakEvenExplanation,
  breakEvenRoas,
  buildGoalsBody,
  goalsToForm,
  parseDecimal,
  sortSignals,
  statusFor,
  summaryChips,
  validateGoals,
} from './attention';

const signal = (rule: string, status: AttentionSignal['status']): AttentionSignal => ({
  rule,
  metric: `meta_ads:${rule}`,
  status,
  title: rule,
  explanation: '',
  suggestion: '',
  evidence: {},
});

describe('AttentionService', () => {
  const service = new AttentionService();

  it('monta o corpo só com o período', () => {
    expect(service.buildBody({ start: '2026-10-13', end: '2026-11-11' })).toEqual({
      start: '2026-10-13',
      end: '2026-11-11',
    });
  });

  it('monta a requisição POST com o header da agência', () => {
    const req = service.request('p 1', 't1', { start: '2026-10-13', end: '2026-11-11' });
    expect(req).toEqual({
      url: '/api/projects/p%201/attention',
      method: 'POST',
      body: { start: '2026-10-13', end: '2026-11-11' },
      headers: { 'X-Tenant-Id': 't1' },
    });
  });
});

describe('resumo e ordenação', () => {
  it('lista os chips por urgência, com plural e sem estados zerados', () => {
    expect(summaryChips({ critical: 2, attention: 0, opportunity: 1 })).toEqual([
      { status: 'critical', count: 2, text: '2 críticos' },
      { status: 'opportunity', count: 1, text: '1 oportunidade' },
    ]);
    expect(summaryChips({ critical: 1, attention: 3, opportunity: 0 }).map((c) => c.text)).toEqual([
      '1 crítico',
      '3 em atenção',
    ]);
    expect(summaryChips({ critical: 0, attention: 0, opportunity: 0 })).toEqual([]);
  });

  it('ordena do mais urgente para o menos, mantendo a ordem entre iguais', () => {
    const sorted = sortSignals([
      signal('a', 'opportunity'),
      signal('b', 'attention'),
      signal('c', 'critical'),
      signal('d', 'attention'),
    ]);
    expect(sorted.map((s) => s.rule)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('mapeia o estado da métrica para o selo (nulo quando não avaliada)', () => {
    const statuses = { 'meta_ads:roas': 'critical', 'meta_ads:cpa': 'healthy' } as const;
    expect(statusFor(statuses, 'meta_ads:roas')).toBe('critical');
    expect(statusFor(statuses, 'meta_ads:cpa')).toBe('healthy');
    expect(statusFor(statuses, 'ga4:sessions')).toBeNull();
    expect(statusFor(null, 'meta_ads:roas')).toBeNull();
  });
});

describe('metas do projeto', () => {
  it('calcula o ROAS de equilíbrio pela margem bruta', () => {
    expect(breakEvenRoas(40)).toBe(2.5);
    expect(breakEvenRoas(100)).toBe(1);
    expect(breakEvenRoas(0)).toBeNull();
    expect(breakEvenRoas(120)).toBeNull();
    expect(breakEvenRoas(null)).toBeNull();
  });

  it('explica o efeito da margem em pt-BR', () => {
    expect(breakEvenExplanation(40)).toBe('Com margem de 40%, ROAS abaixo de 2,50 é prejuízo.');
    expect(breakEvenExplanation(33.3)).toBe('Com margem de 33,3%, ROAS abaixo de 3,00 é prejuízo.');
    expect(breakEvenExplanation(null)).toBeNull();
  });

  it('lê números digitados em pt-BR', () => {
    expect(parseDecimal('40')).toBe(40);
    expect(parseDecimal('40,5')).toBe(40.5);
    expect(parseDecimal('1.234,56')).toBe(1234.56);
    expect(parseDecimal('R$ 75,50')).toBe(75.5);
    expect(parseDecimal('2.5')).toBe(2.5);
    expect(parseDecimal('  ')).toBeNull();
    expect(parseDecimal('abc')).toBeNaN();
  });

  it('manda nulo nos campos vazios do PATCH', () => {
    expect(buildGoalsBody({ gross_margin_pct: '40', target_cpa: '', target_roas: ' ' })).toEqual({
      goals: { gross_margin_pct: 40, target_cpa: null, target_roas: null },
    });
  });

  it('valida no cliente com as mesmas chaves do 422', () => {
    expect(validateGoals({ gross_margin_pct: '150', target_cpa: 'x', target_roas: '0' })).toEqual({
      'goals.gross_margin_pct': 'A margem bruta vai de 0 a 100%.',
      'goals.target_cpa': 'Use apenas números (ex.: 40 ou 40,5).',
      'goals.target_roas': 'Precisa ser maior que zero.',
    });
    expect(validateGoals({ gross_margin_pct: '', target_cpa: '75,5', target_roas: '' })).toEqual({});
  });

  it('preenche o formulário com os valores atuais', () => {
    expect(goalsToForm({ gross_margin_pct: 40, target_cpa: 75.5, target_roas: null })).toEqual({
      gross_margin_pct: '40',
      target_cpa: '75,5',
      target_roas: '',
    });
    expect(goalsToForm(undefined)).toEqual({ gross_margin_pct: '', target_cpa: '', target_roas: '' });
  });
});
