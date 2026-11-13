import { HttpResourceRequest } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  API,
  Account,
  CompareMode,
  DateRange,
  MetricDirection,
  MetricsQueryBody,
  Provider,
  TENANT_HEADER,
} from '../api/api.types';
import { KpiDirection, MetricFormatter, metricFormatter } from 'design-system';

/** Limite do backend para métricas por consulta. */
export const MAX_METRICS_PER_QUERY = 40;

/** Monta as consultas de métricas de um projeto (POST /api/projects/{id}/metrics/query). */
@Injectable({ providedIn: 'root' })
export class MetricsQueryService {
  /** Corpo da consulta: métricas sem repetição, na ordem recebida, até o limite do backend. */
  buildBody(range: DateRange, compare: CompareMode, metrics: readonly string[], series = true): MetricsQueryBody {
    const unique = [...new Set(metrics.map((m) => m.trim()).filter(Boolean))].slice(0, MAX_METRICS_PER_QUERY);
    return { start: range.start, end: range.end, compare, metrics: unique, series };
  }

  /** Requisição para httpResource (POST com o header da agência, para refazer ao trocar de agência). */
  request(projectId: string, tenantId: string, body: MetricsQueryBody): HttpResourceRequest {
    return {
      url: API.projectMetricsQuery(projectId),
      method: 'POST',
      body,
      headers: { [TENANT_HEADER]: tenantId },
    };
  }

  /**
   * Métricas em destaque dos canais das contas vinculadas, na ordem do catálogo de providers.
   * Providers sem conta vinculada ficam de fora.
   */
  featuredMetricsFor(accounts: readonly Account[], providers: readonly Provider[]): string[] {
    const linked = new Set(accounts.map((a) => a.provider));
    return providers.filter((p) => linked.has(p.key)).flatMap((p) => p.featured_metrics);
  }
}

/** Direção da métrica no vocabulário do KPI tile do design system. */
export function kpiDirection(direction: MetricDirection): KpiDirection {
  return direction === 'lower_is_better' ? 'down-is-good' : 'up-is-good';
}

const formatters = new Map<string, MetricFormatter>();

/** Formatador estável por unidade/casas (mesma referência entre renderizações). */
export function formatterFor(unit: Parameters<typeof metricFormatter>[0], decimals: number): MetricFormatter {
  const key = `${unit}:${decimals}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = metricFormatter(unit, decimals);
    formatters.set(key, formatter);
  }
  return formatter;
}
