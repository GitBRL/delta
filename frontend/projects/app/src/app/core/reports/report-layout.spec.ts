import { ReportLayout } from '../api/api.types';
import {
  addBlock,
  canMoveBlock,
  createBlock,
  draftSignature,
  mapLayoutErrors,
  moveBlock,
  moveSection,
  newId,
  pendingBlocks,
  previewLayout,
  removeBlock,
  saveBody,
  suggestedTitle,
  updateBlock,
  validateLayout,
} from './report-layout';
import { groupOptions, metricOptions } from './report-metrics';
import { parseReportText } from './report-text';
import { pdfFilename } from './report-pdf';

const LAYOUT: ReportLayout = {
  sections: [
    {
      id: 's1',
      title: 'Resumo',
      blocks: [
        { id: 'b1', type: 'text', content: 'Oi' },
        { id: 'b2', type: 'kpis', metrics: ['meta_ads:spend'] },
      ],
    },
    { id: 's2', title: 'Meta Ads', blocks: [{ id: 'b3', type: 'chart', metric: 'meta_ads:spend' }] },
  ],
};

describe('layout do relatório', () => {
  it('gera ids válidos para o backend', () => {
    expect(newId('b')).toMatch(/^b[a-z0-9]{8}$/);
    expect(createBlock('attention')).toMatchObject({ type: 'attention', limit: 5 });
    expect(createBlock('chart')).toMatchObject({ type: 'chart', metric: '' });
  });

  it('move blocos dentro da seção e para a vizinha nas bordas', () => {
    const down = moveBlock(LAYOUT, 'b1', 1);
    expect(down.sections[0].blocks.map((b) => b.id)).toEqual(['b2', 'b1']);

    const across = moveBlock(LAYOUT, 'b2', 1);
    expect(across.sections[0].blocks.map((b) => b.id)).toEqual(['b1']);
    expect(across.sections[1].blocks.map((b) => b.id)).toEqual(['b2', 'b3']);

    const back = moveBlock(LAYOUT, 'b3', -1);
    expect(back.sections[0].blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);

    expect(canMoveBlock(LAYOUT, 'b1', -1)).toBe(false);
    expect(canMoveBlock(LAYOUT, 'b3', 1)).toBe(false);
    expect(moveBlock(LAYOUT, 'b1', -1)).toBe(LAYOUT);
    expect(moveSection(LAYOUT, 's2', -1).sections.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('adiciona, atualiza e remove sem mutar o original', () => {
    const added = addBlock(LAYOUT, 's2', { id: 'b9', type: 'table', metrics: [] });
    const updated = updateBlock(added, 'b9', { metrics: ['meta_ads:cpm'] });
    expect(updated.sections[1].blocks[1]).toEqual({ id: 'b9', type: 'table', metrics: ['meta_ads:cpm'] });
    expect(removeBlock(updated, 'b9').sections[1].blocks).toHaveLength(1);
    expect(LAYOUT.sections[1].blocks).toHaveLength(1);
  });

  it('valida como o backend e separa a prévia dos blocos incompletos', () => {
    const layout: ReportLayout = {
      sections: [
        { id: 's1', title: '', blocks: [{ id: 'k', type: 'kpis', metrics: [] }, { id: 'c', type: 'chart', metric: '' }, { id: 't', type: 'text', content: 'ok' }] },
      ],
    };
    expect(validateLayout(layout)).toEqual({
      s1: 'Dê um título para a seção.',
      k: 'Escolha ao menos uma métrica.',
      c: 'Escolha a métrica do gráfico.',
    });
    expect(previewLayout(layout)).toEqual({ sections: [{ id: 's1', title: 'Seção sem título', blocks: [{ id: 't', type: 'text', content: 'ok' }] }] });
    expect(pendingBlocks(layout)['s1'].map((p) => p.id)).toEqual(['k', 'c']);
    expect(validateLayout(LAYOUT)).toEqual({});
  });

  it('mapeia os erros 422 para o bloco ou seção certos', () => {
    const { byId, general } = mapLayoutErrors(
      {
        'layout.sections.0.blocks.1.metrics': 'Métrica desconhecida: x.',
        'layout.sections.1.title': 'Dê um título para a seção.',
        period_end: 'Os dados vão até ontem.',
        layout: 'Estrutura inválida.',
      },
      LAYOUT,
    );
    expect(byId).toEqual({ b2: 'Métrica desconhecida: x.', s2: 'Dê um título para a seção.' });
    expect(general).toEqual({ period_end: 'Os dados vão até ontem.', layout: 'Estrutura inválida.' });
  });

  it('corpo de salvar, assinatura e título sugerido', () => {
    const draft = { title: ' Mensal ', preset: 'last_30' as const, custom: { start: '2026-01-01', end: '2026-01-31' }, compare: 'none' as const, layout: LAYOUT };
    expect(saveBody(draft)).toMatchObject({ title: 'Mensal', period_preset: 'last_30', period_start: null, period_end: null });
    expect(saveBody({ ...draft, preset: 'custom' })).toMatchObject({ period_start: '2026-01-01', period_end: '2026-01-31' });
    // datas personalizadas não contam enquanto o preset não é "custom"
    expect(draftSignature(draft)).toBe(draftSignature({ ...draft, custom: { start: 'x', end: 'y' } }));
    expect(suggestedTitle('2026-10-31')).toBe('Relatório de outubro');
    expect(suggestedTitle(null)).toBe('Relatório');
    expect(pdfFilename('Relatório de Março 2026-03-01 a 2026-03-31')).toBe('relatorio-de-marco-2026-03-01-a-2026-03-31.pdf');
  });
});

describe('texto da análise', () => {
  it('parágrafos, quebras, negrito e listas (sem HTML)', () => {
    expect(parseReportText('**Bom** <b>x</b>\nlinha\n\n- a\n- **b**')).toEqual([
      { kind: 'p', lines: [[{ text: 'Bom', bold: true }, { text: ' <b>x</b>', bold: false }], [{ text: 'linha', bold: false }]] },
      { kind: 'ul', items: [[{ text: 'a', bold: false }], [{ text: 'b', bold: true }]] },
    ]);
    expect(parseReportText('   ')).toEqual([]);
    expect(parseReportText('- a\nnão é lista')[0].kind).toBe('p');
  });
});

describe('opções de métricas', () => {
  it('canais do projeto primeiro, indicadores no fim e busca sem acento', () => {
    const options = metricOptions(
      [
        { key: 'meta_ads:spend', provider: 'meta_ads', label: 'Investimento', description: '', unit: 'currency', kind: 'additive', direction: 'neutral', decimals: 2, featured: true },
        { key: 'ga4:sessions', provider: 'ga4', label: 'Sessões', description: '', unit: 'count', kind: 'additive', direction: 'higher_is_better', decimals: 0, featured: true },
      ],
      [
        { key: 'meta_ads', name: 'Meta Ads', category: 'ads', available_modes: ['sandbox'], metrics_count: 1, featured_metrics: [] },
        { key: 'ga4', name: 'GA4', category: 'analytics', available_modes: ['sandbox'], metrics_count: 1, featured_metrics: [] },
      ],
      [{ id: 'c1', key: 'custom:cpm', name: 'Custo por mil', description: null, formula: 'x', unit: 'currency', direction: 'lower_is_better', decimals: 2, providers: [], created_at: '', updated_at: '' }],
      ['ga4'],
    );
    expect(options.map((o) => o.key)).toEqual(['ga4:sessions', 'meta_ads:spend', 'custom:cpm']);
    expect(groupOptions(options).map((g) => [g.name, g.linked])).toEqual([
      ['GA4', true],
      ['Meta Ads', false],
      ['Indicadores personalizados', true],
    ]);
    expect(groupOptions(options, 'sessoes').flatMap((g) => g.options.map((o) => o.key))).toEqual(['ga4:sessions']);
  });

  it('inclui as métricas da fonte manual em grupo próprio', () => {
    const options = metricOptions([], [], [], [], [
      { id: 'mm1', key: 'manual:vendas_na_loja', name: 'Vendas na loja', description: null, unit: 'currency', direction: 'higher_is_better', decimals: 2, aggregation: 'sum', created_at: '' },
    ]);
    expect(options).toEqual([
      { key: 'manual:vendas_na_loja', label: 'Vendas na loja', group: 'Dados manuais', description: 'Lançado por dia; soma os dias do período.', linked: true },
    ]);
  });
});
