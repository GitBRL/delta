import { ReportData, ReportMetric } from '../../core/api/api.types';

/** Dados de exemplo para os testes de relatórios (não entra no bundle: só os specs importam). */
export const metric = (over: Partial<ReportMetric>): ReportMetric => ({
  key: 'meta_ads:spend',
  label: 'Investimento',
  unit: 'currency',
  direction: 'neutral',
  decimals: 2,
  value: 1234.5,
  previous: 1000,
  change_pct: 23.45,
  sentiment: 'neutral',
  approximate: false,
  provider: 'meta_ads',
  provider_name: 'Meta Ads',
  status: null,
  ...over,
});

export const REPORT_DATA: ReportData = {
  version: 1,
  title: 'Relatório de outubro',
  agency: 'Agência Norte',
  project: { id: 'p1', name: 'Padaria Aurora', niche: 'restaurante_delivery' },
  period: { start: '2026-10-01', end: '2026-10-31', label: '01/10/2026 – 31/10/2026' },
  compare: 'previous_period',
  comparison: { start: '2026-08-31', end: '2026-09-30' },
  generated_at: '2026-11-12T10:00:00Z',
  sections: [
    {
      id: 's1',
      title: 'Resumo do período',
      blocks: [
        { id: 'b1', type: 'text', title: 'Análise da agência', content: '**Ótimo mês!** <script>alert(1)</script>\nsegunda linha\n\n- item A\n- item B' },
        {
          id: 'b2',
          type: 'kpis',
          title: 'Números principais',
          mixed: true,
          metrics: [
            metric({ status: 'healthy' }),
            metric({ key: 'instagram:reach', label: 'Alcance', unit: 'count', provider: 'instagram', provider_name: 'Instagram', sentiment: 'negative', change_pct: -6.6 }),
          ],
        },
        { id: 'b3', type: 'attention', title: 'Pontos de atenção', summary: { critical: 1, attention: 0, opportunity: 0 }, signals: [
          { rule: 'r1', metric: 'meta_ads:roas', status: 'critical', title: 'ROAS abaixo do equilíbrio', explanation: 'ROAS 1,2 com margem de 30%.', suggestion: 'Revise as campanhas.', evidence: {} },
        ] },
      ],
    },
    {
      id: 's2',
      title: 'Meta Ads',
      blocks: [
        { id: 'b4', type: 'chart', title: null, metric: metric({ key: 'meta_ads:conversions', label: 'Conversões', unit: 'count', series: [{ date: '2026-10-01', value: 3 }, { date: '2026-10-02', value: 5 }], previous_series: [{ date: '2026-09-01', value: 4 }, { date: '2026-09-02', value: 4 }] }) },
        { id: 'b5', type: 'table', title: 'Detalhamento', mixed: false, metrics: [metric({ key: 'meta_ads:cpm', label: 'CPM', sentiment: 'positive', change_pct: -1.2, direction: 'lower_is_better' })] },
        { id: 'b6', type: 'kpis', title: null, mixed: false, metrics: [] },
        { id: 'b7', type: 'attention', title: null, summary: { critical: 0, attention: 0, opportunity: 0 }, signals: [] },
      ],
    },
  ],
};
