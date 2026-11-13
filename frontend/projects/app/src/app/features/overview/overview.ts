import {
  CompareMode,
  OverviewHealth,
  OverviewKpi,
  OverviewProjectStatus,
  RelativePeriodPreset,
} from '../../core/api/api.types';

/** Períodos da Visão geral (relativos; "personalizado" fica nos relatórios). */
export const OVERVIEW_PRESETS: readonly { value: RelativePeriodPreset; label: string }[] = [
  { value: 'last_7', label: 'Últimos 7 dias' },
  { value: 'last_14', label: 'Últimos 14 dias' },
  { value: 'last_30', label: 'Últimos 30 dias' },
  { value: 'last_month', label: 'Mês passado' },
  { value: 'this_month', label: 'Este mês' },
];

export const PROJECT_STATUS_LABEL: Readonly<Record<OverviewProjectStatus, string>> = {
  critical: 'Crítico',
  attention: 'Atenção',
  opportunity: 'Oportunidade',
  healthy: 'Saudável',
  no_data: 'Sem dados',
};

/** Variação do KPI no formato do ds-kpi-tile (fração); sem comparação, sem seta. */
export function kpiTrend(kpi: OverviewKpi, compare: CompareMode): number | null {
  return compare === 'none' || kpi.change_pct === null ? null : kpi.change_pct / 100;
}

export interface HealthLegendItem {
  key: keyof OverviewHealth;
  label: string;
  value: number | null;
}

const HEALTH_LABEL: Readonly<Record<keyof OverviewHealth, string>> = {
  acquisition: 'Aquisição',
  engagement: 'Engajamento',
  conversion: 'Conversão',
};

/** Legenda dos anéis: null vira "sem dados" (o anel fica vazio, nunca um 0 enganoso). */
export function healthLegend(health: OverviewHealth): HealthLegendItem[] {
  return (Object.keys(HEALTH_LABEL) as (keyof OverviewHealth)[]).map((key) => ({
    key,
    label: HEALTH_LABEL[key],
    value: health[key],
  }));
}

export function hasAnyHealth(health: OverviewHealth): boolean {
  return Object.values(health).some((v) => v !== null);
}
