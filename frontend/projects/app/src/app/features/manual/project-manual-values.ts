import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsButton, DsSkeleton, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ApiEnvelope,
  ManualImportResult,
  ManualMetric,
  ManualValue,
  ManualValuesBody,
  ManualValuesSaved,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { formatterFor } from '../../core/metrics/metrics-query.service';
import { TenantService } from '../../core/tenant/tenant.service';
import { cellText, changedEntries, currentMonth, monthDays, monthLabel, monthTotal, parseCell } from './manual';

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });

/**
 * Dados manuais do projeto: escolher a métrica e o mês, digitar os dias (salva em lote) ou colar
 * a planilha ("data;valor"). Mostra o total do mês conforme a agregação da métrica.
 * Cliente vê os valores sem editar.
 */
@Component({
  selector: 'app-project-manual-values',
  imports: [RouterLink, DsButton, DsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="manual-title">
      <div class="head">
        <h2 id="manual-title" class="m-0 text-headline">Dados manuais</h2>
        @if (canEdit()) {
          <a class="manage" routerLink="/dados-manuais">Gerenciar métricas</a>
        }
      </div>

      @if (metrics.isLoading() && !metrics.hasValue()) {
        <ds-skeleton width="70%" />
      } @else if (metricList().length === 0) {
        <p class="m-0 text-footnote text-fg-muted">
          Nenhuma métrica manual na agência.
          @if (canEdit()) {
            Crie em <a routerLink="/dados-manuais">Dados manuais</a> (ex.: vendas da loja, leads do CRM).
          }
        </p>
      } @else {
        <div class="pickers">
          <label class="field grow">
            <span>Métrica</span>
            <select name="manual_metric" (change)="selectMetric($any($event.target).value)">
              @for (m of metricList(); track m.id) {
                <option [value]="m.id" [selected]="m.id === metric()?.id">{{ m.name }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span>Mês</span>
            <input type="month" name="manual_month" [value]="month()" (change)="selectMonth($any($event.target).value)" />
          </label>
        </div>

        @if (metric(); as m) {
          <p class="total" role="status">
            {{ m.aggregation === 'sum' ? 'Total de' : 'Último valor de' }} {{ monthName() }}:
            <strong>{{ totalText() }}</strong>
            @if (dirty()) {
              <span class="pending">· alterações não salvas</span>
            }
          </p>

          @if (values.isLoading() && !values.hasValue()) {
            <ds-skeleton height="120px" radius="var(--ds-radius-md)" />
          } @else {
            <div class="grid" role="group" [attr.aria-label]="'Valores de ' + m.name + ' em ' + monthName()">
              @for (day of days(); track day) {
                <label class="cell" [class.invalid]="invalid().has(day)" [class.edited]="edits().has(day)">
                  <span class="day">{{ dayLabel(day) }}</span>
                  <input
                    type="text"
                    inputmode="decimal"
                    [attr.name]="'manual_' + day"
                    [attr.aria-label]="'Valor em ' + dayLong(day)"
                    [readOnly]="!canEdit()"
                    [value]="cell(day)"
                    (input)="edit(day, $any($event.target).value)"
                  />
                </label>
              }
            </div>
            @if (invalid().size > 0) {
              <p class="error" role="alert">Há valores inválidos: use números como 1234,56.</p>
            }

            @if (canEdit()) {
              <div class="actions">
                <button ds-button size="sm" [disabled]="!dirty() || invalid().size > 0" [loading]="saving()" (click)="save()">Salvar valores</button>
                @if (dirty()) {
                  <button ds-button variant="ghost" size="sm" (click)="discard()">Descartar</button>
                }
                <button ds-button variant="ghost" size="sm" (click)="pasting.set(!pasting())" [attr.aria-expanded]="pasting()">Colar planilha</button>
              </div>

              @if (pasting()) {
                <div class="paste">
                  <label class="field">
                    <span>Cole as linhas "data;valor" (datas 31/10/2026 ou 2026-10-31; valores 1.234,56)</span>
                    <textarea
                      name="manual_csv"
                      rows="6"
                      placeholder="01/11/2026;1.250,00&#10;02/11/2026;980,50"
                      [value]="csv()"
                      (input)="csv.set($any($event.target).value)"
                    ></textarea>
                  </label>
                  <button ds-button size="sm" [disabled]="!csv().trim()" [loading]="importing()" (click)="importCsv()">Importar</button>
                  @if (importResult(); as r) {
                    <div class="result" role="status">
                      <p class="m-0 text-footnote font-semibold">
                        {{ r.saved }} {{ r.saved === 1 ? 'valor gravado' : 'valores gravados' }}
                        @if (r.errors.length) {
                          · {{ r.errors.length }} {{ r.errors.length === 1 ? 'linha com erro' : 'linhas com erro' }}
                        }
                      </p>
                      @if (r.errors.length) {
                        <ul class="errors">
                          @for (e of r.errors; track e.line) {
                            <li>Linha {{ e.line }}: {{ e.message }}</li>
                          }
                        </ul>
                      }
                    </div>
                  }
                </div>
              }
            }
          }
        }
      }
    </section>
  `,
  styles: `
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-2);
      margin-bottom: var(--ds-space-3);
    }
    .manage {
      font: var(--ds-text-footnote);
      color: var(--ds-accent);
      text-decoration: none;
    }
    .pickers {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-3);
      margin-bottom: var(--ds-space-3);
    }
    .grow {
      flex: 1;
      min-width: 160px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font: var(--ds-text-caption);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .field select,
    .field input,
    .field textarea {
      min-height: 36px;
      padding: 6px 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-sm);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
    }
    .field textarea {
      font-family: var(--ds-font-mono);
      resize: vertical;
    }
    .total {
      margin: 0 0 var(--ds-space-2);
      font: var(--ds-text-footnote);
    }
    .pending {
      color: var(--ds-status-attention);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
      gap: 6px;
    }
    .cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px 6px;
      border-radius: var(--ds-radius-sm);
      background: var(--ds-fill);
    }
    .cell.edited {
      box-shadow: inset 0 0 0 1px var(--ds-accent);
    }
    .cell.invalid {
      box-shadow: inset 0 0 0 1px var(--ds-status-critical);
    }
    .day {
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
    .cell input {
      width: 100%;
      min-width: 0;
      height: 26px;
      padding: 0 4px;
      border: 0;
      border-radius: 4px;
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-footnote);
      font-variant-numeric: tabular-nums;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-2);
      margin-top: var(--ds-space-3);
    }
    .paste {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--ds-space-2);
      margin-top: var(--ds-space-3);
    }
    .paste .field {
      width: 100%;
    }
    .result {
      padding: var(--ds-space-2) var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
    }
    .errors {
      margin: 4px 0 0;
      padding-left: 18px;
      font: var(--ds-text-caption);
      color: var(--ds-status-critical);
    }
    .error {
      margin: 6px 0 0;
      font: var(--ds-text-caption);
      color: var(--ds-status-critical);
    }
  `,
})
export class ProjectManualValues {
  readonly projectId = input.required<string>();
  readonly canEdit = input(false);
  /** Valores salvos ou importados (o projeto pode recalcular indicadores). */
  readonly changed = output<void>();

  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  private readonly tenant = inject(TenantService);

  private readonly request = (url: string, params?: Record<string, string>) => {
    const tenantId = this.tenant.currentId();
    return tenantId ? { url, params, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  };

  readonly metrics = httpResource<ApiEnvelope<ManualMetric[]>>(() => this.request(API.manualMetrics));
  protected readonly metricList = computed(() => (this.metrics.hasValue() ? this.metrics.value().data : []));

  private readonly metricId = signal<string | null>(null);
  readonly metric = computed(() => {
    const list = this.metricList();
    return list.find((m) => m.id === this.metricId()) ?? list[0] ?? null;
  });
  readonly month = signal(currentMonth());
  readonly days = computed(() => monthDays(this.month()));
  protected readonly monthName = computed(() => monthLabel(this.month()));

  readonly values = httpResource<ApiEnvelope<ManualValue[]>>(() => {
    const m = this.metric();
    const days = this.days();
    if (!m || days.length === 0) return undefined;
    return this.request(API.projectManualValues(this.projectId()), { metric_id: m.id, start: days[0], end: days[days.length - 1] });
  });

  /** Valores salvos do mês (data → valor). */
  private readonly saved = computed(() => {
    const map = new Map<string, number>();
    for (const v of this.values.hasValue() ? this.values.value().data : []) map.set(v.date, Number(v.value));
    return map;
  });

  /** Texto digitado por dia (só o que mudou). */
  readonly edits = signal<ReadonlyMap<string, string>>(new Map());

  private readonly parsedEdits = computed(() => {
    const out = new Map<string, number | null>();
    for (const [day, text] of this.edits()) out.set(day, parseCell(text));
    return out;
  });
  readonly invalid = computed(() => new Set([...this.parsedEdits()].filter(([, v]) => v !== null && Number.isNaN(v)).map(([d]) => d)));
  readonly entries = computed(() => changedEntries(this.saved(), this.parsedEdits()));
  readonly dirty = computed(() => this.entries().length > 0);

  /** Valores efetivos (salvos + edição válida), para o total. */
  private readonly effective = computed(() => {
    const map = new Map(this.saved());
    for (const [day, value] of this.parsedEdits()) {
      if (value === null) map.delete(day);
      else if (!Number.isNaN(value)) map.set(day, value);
    }
    return map;
  });
  protected readonly totalText = computed(() => {
    const m = this.metric();
    if (!m) return '—';
    const total = monthTotal(this.effective(), this.days(), m.aggregation);
    return total === null ? 'sem lançamentos' : formatterFor(m.unit, m.decimals)(total);
  });

  readonly saving = signal(false);
  readonly pasting = signal(false);
  readonly csv = signal('');
  readonly importing = signal(false);
  readonly importResult = signal<ManualImportResult | null>(null);

  constructor() {
    // Trocar de métrica ou mês descarta a edição em andamento daquele recorte.
    effect(() => {
      this.metric();
      this.month();
      untracked(() => {
        this.edits.set(new Map());
        this.importResult.set(null);
      });
    });
  }

  protected selectMetric(id: string): void {
    this.metricId.set(id);
  }

  protected selectMonth(value: string): void {
    if (/^\d{4}-\d{2}$/.test(value)) this.month.set(value);
  }

  protected cell(day: string): string {
    const edited = this.edits().get(day);
    if (edited !== undefined) return edited;
    return cellText(this.saved().get(day), this.metric()?.decimals ?? 0);
  }

  protected dayLabel(day: string): string {
    const [y, m, d] = day.split('-').map(Number);
    return `${d} ${WEEKDAY.format(new Date(y, m - 1, d)).replace('.', '')}`;
  }

  protected dayLong(day: string): string {
    return day.split('-').reverse().join('/');
  }

  edit(day: string, text: string): void {
    this.edits.update((all) => new Map(all).set(day, text));
  }

  discard(): void {
    this.edits.set(new Map());
  }

  async save(): Promise<void> {
    const tenantId = this.tenant.currentId();
    const m = this.metric();
    if (!tenantId || !m || !this.dirty() || this.invalid().size > 0 || this.saving()) return;

    const body: ManualValuesBody = { metric_id: m.id, entries: this.entries() };
    this.saving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiEnvelope<ManualValuesSaved>>(API.projectManualValues(this.projectId()), body, {
          headers: { [TENANT_HEADER]: tenantId },
        }),
      );
      const { saved, deleted } = res.data;
      this.toast.success('Valores salvos', {
        message: `${saved} ${saved === 1 ? 'dia gravado' : 'dias gravados'}${deleted ? `, ${deleted} apagado(s)` : ''}.`,
      });
      this.edits.set(new Map());
      this.values.reload();
      this.changed.emit();
    } catch (error) {
      if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
        this.toast.error('Não foi possível salvar os valores');
      }
    } finally {
      this.saving.set(false);
    }
  }

  async importCsv(): Promise<void> {
    const tenantId = this.tenant.currentId();
    const m = this.metric();
    if (!tenantId || !m || !this.csv().trim() || this.importing()) return;

    this.importing.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiEnvelope<ManualImportResult>>(
          API.projectManualImport(this.projectId()),
          { metric_id: m.id, csv: this.csv() },
          { headers: { [TENANT_HEADER]: tenantId } },
        ),
      );
      this.importResult.set(res.data);
      if (res.data.errors.length === 0) this.csv.set('');
      if (res.data.saved > 0) {
        this.values.reload();
        this.changed.emit();
      }
    } catch (error) {
      if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
        this.toast.error('Não foi possível importar a planilha');
      }
    } finally {
      this.importing.set(false);
    }
  }
}
