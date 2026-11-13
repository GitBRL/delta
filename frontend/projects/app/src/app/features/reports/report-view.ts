import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DsAreaChart, DsKpiTile, MetricFormatter } from 'design-system';
import { PublicBranding, ReportBlockType, ReportData, ReportDataBlock, ReportMetric } from '../../core/api/api.types';
import { formatterFor, kpiDirection } from '../../core/metrics/metrics-query.service';
import { compareCaption, formatRange } from '../../core/metrics/period';
import { TextNode, parseReportText } from '../../core/reports/report-text';
import { blockTypeLabel } from '../../core/reports/report-layout';
import { ReportSignals } from './report-signals';

const PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "▲ 12,5%", "▼ 6,0%", "= 0,0%" ou "—". */
export function changeText(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '=';
  return `${arrow} ${PCT.format(Math.abs(pct))}%`;
}

export interface PendingBlock {
  id: string;
  type: ReportBlockType;
  message: string;
}

/**
 * Relatório renderizado (o mesmo formato na prévia do montador, na versão publicada e no link
 * público). Só apresenta: quem busca os dados é a tela. No montador, `selectable` deixa clicar
 * num bloco para editá-lo e `pending` mostra os blocos ainda incompletos.
 */
@Component({
  selector: 'app-report-view',
  imports: [DsKpiTile, DsAreaChart, ReportSignals],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './report-view.html',
  styleUrl: './report-view.css',
})
export class ReportView {
  readonly data = input.required<ReportData>();
  readonly selectable = input(false);
  /** Capa com agência, título e período (o modo TV mostra a sua própria barra no lugar). */
  readonly showCover = input(true);
  /** Marca da agência (white label): cor da capa, logo no lugar do Δ e nome. */
  readonly brand = input<PublicBranding | null>(null);
  readonly selectedId = input<string | null>(null);
  /** Blocos ainda incompletos, por seção (só no montador). */
  readonly pending = input<Readonly<Record<string, readonly PendingBlock[]>>>({});
  readonly blockSelect = output<string>();

  protected readonly formatRange = formatRange;
  protected readonly changeText = changeText;
  protected readonly blockTypeLabel = blockTypeLabel;
  protected readonly kpiDirection = kpiDirection;

  protected readonly hasComparison = computed(() => this.data().compare !== 'none');
  protected readonly comparisonCaption = computed(() => compareCaption(this.data().compare));
  protected readonly comparisonLabel = computed(() =>
    this.data().compare === 'previous_year' ? 'Ano anterior' : 'Período anterior',
  );

  private readonly textCache = new Map<string, TextNode[]>();

  protected formatter(metric: ReportMetric): MetricFormatter {
    return formatterFor(metric.unit, metric.decimals);
  }

  protected format(metric: ReportMetric, value: number | null): string {
    return value === null ? '—' : this.formatter(metric)(value);
  }

  protected label(metric: ReportMetric, mixed: boolean): string {
    return mixed ? `${metric.label} · ${metric.provider_name}` : metric.label;
  }

  protected trend(metric: ReportMetric): number | null {
    return !this.hasComparison() || metric.change_pct === null ? null : metric.change_pct / 100;
  }

  protected textNodes(content: string): TextNode[] {
    let nodes = this.textCache.get(content);
    if (!nodes) {
      nodes = parseReportText(content);
      if (this.textCache.size > 50) this.textCache.clear();
      this.textCache.set(content, nodes);
    }
    return nodes;
  }

  protected blockTitle(block: ReportDataBlock): string | null {
    return block.title?.trim() || null;
  }

  protected pick(blockId: string): void {
    if (this.selectable()) this.blockSelect.emit(blockId);
  }
}
