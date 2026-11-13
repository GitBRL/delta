import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DsButton, DsGlassCard, DsIcon, DsSkeleton, DsTextField, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { API, ApiEnvelope, DataImport } from '../../core/api/api.types';
import { extractFieldErrors } from '../../core/forms/server-errors';
import { relativeTime } from '../../core/format/relative-time';
import { pollWhile } from '../../core/polling/poll-while';
import { TenantService } from '../../core/tenant/tenant.service';
import {
  IMPORT_POLL_MS,
  IMPORT_STATUS,
  groupReconnect,
  importRunning,
  importSummaryLine,
  importTokenProblem,
  importTotals,
  readChecked,
  writeChecked,
} from './importer';

/**
 * Configurações › Importar do Reportei (dono/admin): projetos, marcos da linha do tempo e a
 * lista de contas para reconectar. O token vai uma vez para a fila, criptografado, e não fica
 * guardado. ADR 0022.
 */
@Component({
  selector: 'app-import-page',
  imports: [FormsModule, RouterLink, DsButton, DsGlassCard, DsIcon, DsSkeleton, DsTextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-8">
      <a class="back" routerLink="/configuracoes">‹ Configurações</a>
      <h1 class="m-0 mt-1 text-large-title font-bold tracking-tight">Importar do Reportei</h1>
      <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
        Traz os projetos e os marcos da linha do tempo da sua conta no Reportei. As contas das plataformas precisam ser
        conectadas de novo no Delta (o acesso não é transferível): no fim, você recebe a lista do que reconectar.
      </p>
    </header>

    @if (!tenant.isAdmin()) {
      <ds-glass-card padding="lg" role="note">
        <p class="m-0 text-headline">Só donos e administradores da agência importam dados.</p>
      </ds-glass-card>
    } @else {
      <div class="col">
        <ds-glass-card padding="lg">
          <form class="form" (submit)="$event.preventDefault(); start()" novalidate>
            <ds-text-field
              label="Token da API do Reportei"
              type="password"
              name="reportei_token"
              autocomplete="off"
              placeholder="Cole o token"
              hint="No Reportei: Configurações da Empresa › API. O token é usado só nesta importação e não fica guardado."
              [ngModel]="token()"
              (ngModelChange)="token.set($event); tokenError.set(null)"
              [error]="tokenError()"
              [maxlength]="2000"
            />
            <div class="actions">
              <button ds-button type="submit" [loading]="starting()" [disabled]="running()">
                <svg dsIcon="download" [size]="16"></svg>
                Importar
              </button>
              @if (running()) {
                <span class="text-footnote text-fg-muted" role="status">Uma importação está em andamento.</span>
              }
            </div>
          </form>
        </ds-glass-card>

        @if (current(); as imp) {
          @let st = statusMeta[imp.status];
          @let totals = totalsOf(imp);
          <ds-glass-card padding="lg" data-testid="current-import">
            <div class="row-head">
              <h2 class="m-0 text-headline">Importação {{ imp.created_at ? relativeTime(imp.created_at) : '' }}</h2>
              <span class="chip" [attr.data-tone]="st.tone" role="status" aria-live="polite">{{ st.label }}</span>
            </div>

            @if (isRunning(imp)) {
              <div class="progress" aria-busy="true">
                <ds-skeleton width="100%" height="8px" radius="999px" />
                <p class="m-0 text-footnote text-fg-muted">Buscando projetos e marcos no Reportei. Você pode sair desta tela: a importação continua.</p>
              </div>
            } @else if (imp.status === 'failed') {
              <p class="m-0 mt-2 error" role="alert">{{ imp.error ?? 'A importação falhou. Confira o token e tente de novo.' }}</p>
            } @else {
              <dl class="totals">
                <div><dt>Projetos criados</dt><dd>{{ totals.projectsCreated }}</dd></div>
                <div><dt>Projetos que já existiam</dt><dd>{{ totals.projectsExisting }}</dd></div>
                <div><dt>Marcos na linha do tempo</dt><dd>{{ totals.timelineEvents }}</dd></div>
              </dl>

              @if (groups().length) {
                <section class="reconnect" aria-labelledby="reconnect-title">
                  <div class="row-head">
                    <h3 id="reconnect-title" class="m-0 text-headline">Contas para reconectar</h3>
                    <span class="text-footnote text-fg-muted" data-testid="reconnect-progress">
                      {{ checkedCount() }} de {{ totals.reconnect.length }}
                    </span>
                  </div>
                  <p class="m-0 text-footnote text-fg-muted">
                    Conecte cada conta em
                    <a routerLink="/integracoes">Integrações</a>
                    e depois ligue-a ao projeto. Marque aqui o que já foi feito (fica salvo neste navegador).
                  </p>
                  @for (group of groups(); track group.project) {
                    <div class="group">
                      <p class="group-title">{{ group.project }}</p>
                      <ul class="checklist">
                        @for (item of group.items; track item.key) {
                          <li>
                            <label>
                              <input type="checkbox" [checked]="checked().has(item.key)" (change)="toggle(imp.id, item.key)" />
                              <span [class.done]="checked().has(item.key)">
                                <strong>{{ item.platform }}</strong>
                                @if (item.account) {
                                  · {{ item.account }}
                                }
                              </span>
                            </label>
                          </li>
                        }
                      </ul>
                    </div>
                  }
                  <a ds-button variant="secondary" size="sm" routerLink="/integracoes">Abrir Integrações</a>
                </section>
              } @else {
                <p class="m-0 mt-3 text-footnote text-fg-muted">Nenhuma conta para reconectar.</p>
              }
            }
          </ds-glass-card>
        }

        <ds-glass-card padding="lg">
          <h2 class="m-0 mb-3 text-headline">Importações anteriores</h2>
          @if (history.isLoading() && !history.hasValue()) {
            <ds-skeleton width="60%" />
          } @else if (history.error() && !history.hasValue()) {
            <p class="m-0 text-footnote" role="alert">
              Não foi possível carregar o histórico.
              <button type="button" class="link" (click)="history.reload()">Tentar de novo</button>
            </p>
          } @else if (historyList().length === 0) {
            <p class="m-0 text-footnote text-fg-muted">Nenhuma importação ainda.</p>
          } @else {
            <ul class="history">
              @for (item of historyList(); track item.id) {
                <li>
                  <button type="button" class="history-item" [class.active]="current()?.id === item.id" [attr.aria-pressed]="current()?.id === item.id" (click)="show(item)">
                    <span class="chip" [attr.data-tone]="statusMeta[item.status].tone">{{ statusMeta[item.status].label }}</span>
                    <span class="min-w-0 flex-1 text-footnote">{{ summaryLine(item) }}</span>
                    <span class="text-caption text-fg-subtle">{{ item.created_at ? relativeTime(item.created_at) : '' }}</span>
                  </button>
                </li>
              }
            </ul>
          }
        </ds-glass-card>
      </div>
    }
  `,
  styles: `
    .back {
      font: var(--ds-text-footnote);
      color: var(--ds-accent);
      text-decoration: none;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
      max-width: 760px;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
    }
    .actions,
    .row-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .row-head {
      justify-content: space-between;
    }
    .chip {
      padding: 2px 10px;
      border-radius: var(--ds-radius-full);
      font: var(--ds-text-caption);
      font-weight: 600;
      white-space: nowrap;
      background: var(--ds-fill);
      color: var(--ds-text-secondary);
    }
    .chip[data-tone='ok'] {
      background: color-mix(in oklch, var(--ds-status-healthy) 16%, transparent);
      color: var(--ds-status-healthy);
    }
    .chip[data-tone='warn'] {
      background: color-mix(in oklch, var(--ds-status-critical) 14%, transparent);
      color: var(--ds-status-critical);
    }
    .chip[data-tone='busy'] {
      background: color-mix(in oklch, var(--ds-status-opportunity) 16%, transparent);
      color: var(--ds-status-opportunity);
    }
    .progress {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin-top: var(--ds-space-3);
    }
    .totals {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: var(--ds-space-3);
      margin: var(--ds-space-4) 0 0;
    }
    .totals div {
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
    }
    .totals dt {
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
    }
    .totals dd {
      margin: 2px 0 0;
      font: var(--ds-text-title-2);
      font-weight: 700;
    }
    .reconnect {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--ds-space-3);
      margin-top: var(--ds-space-5);
    }
    .reconnect .row-head {
      width: 100%;
    }
    .reconnect a:not([ds-button]) {
      color: var(--ds-accent);
    }
    .group {
      width: 100%;
    }
    .group-title {
      margin: 0 0 4px;
      font: var(--ds-text-footnote);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .checklist {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .checklist label {
      display: flex;
      align-items: center;
      gap: var(--ds-space-2);
      min-height: 32px;
      font: var(--ds-text-subhead);
      cursor: pointer;
    }
    .done {
      color: var(--ds-text-tertiary);
      text-decoration: line-through;
    }
    .history {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .history-item {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
      width: 100%;
      padding: 8px 10px;
      border: 0;
      border-radius: var(--ds-radius-md);
      background: none;
      color: var(--ds-text);
      text-align: left;
      cursor: pointer;
    }
    .history-item:hover,
    .history-item.active {
      background: var(--ds-fill);
    }
    .history-item:focus-visible {
      outline: 2px solid var(--ds-accent);
      outline-offset: 2px;
    }
    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--ds-accent);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .error {
      color: var(--ds-status-critical);
      font: var(--ds-text-footnote);
    }
  `,
})
export class ImportPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);

  protected readonly statusMeta = IMPORT_STATUS;
  protected readonly relativeTime = relativeTime;
  protected readonly summaryLine = importSummaryLine;
  protected readonly totalsOf = importTotals;
  protected readonly isRunning = importRunning;

  readonly history = httpResource<ApiEnvelope<DataImport[]>>(() =>
    this.tenant.isAdmin() && this.tenant.currentId() ? API.imports : undefined,
  );
  protected readonly historyList = computed(() => (this.history.hasValue() ? this.history.value().data : []));

  readonly token = signal('');
  readonly tokenError = signal<string | null>(null);
  readonly starting = signal(false);
  /** Importação em destaque: a que acabou de começar ou a escolhida no histórico. */
  readonly current = signal<DataImport | null>(null);
  readonly running = computed(() => importRunning(this.current()));
  readonly checked = signal<ReadonlySet<string>>(new Set());

  protected readonly groups = computed(() => {
    const imp = this.current();
    return imp && imp.status === 'done' ? groupReconnect(imp.id, importTotals(imp).reconnect) : [];
  });
  protected readonly checkedCount = computed(() => this.groups().reduce((n, g) => n + g.items.filter((i) => this.checked().has(i.key)).length, 0));

  constructor() {
    // Enquanto estiver na fila ou importando, consulta a cada 2 s.
    pollWhile(() => this.running(), () => void this.refresh(), IMPORT_POLL_MS);
  }

  async start(): Promise<void> {
    if (this.starting() || this.running()) return;
    const problem = importTokenProblem(this.token());
    if (problem) {
      this.tokenError.set(problem);
      return;
    }
    this.starting.set(true);
    try {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<DataImport>>(API.importReportei, { token: this.token().trim() }));
      this.token.set(''); // o token não fica na tela
      this.show(res.data);
      this.history.reload();
      if (res.data.status === 'failed') this.toast.error('A importação falhou', { message: res.data.error ?? undefined });
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields) {
        this.tokenError.set(fields['token'] ?? Object.values(fields)[0] ?? 'Confira o token.');
      } else {
        const status = error instanceof HttpErrorResponse ? error.status : null;
        if (status === 429) this.toast.info('Muitas importações seguidas', { message: 'Espere um minuto e tente de novo.' });
        else if (status !== 403 && status !== 0 && (status ?? 500) < 500) this.toast.error('Não foi possível começar a importação');
      }
    } finally {
      this.starting.set(false);
    }
  }

  show(item: DataImport): void {
    this.current.set(item);
    this.checked.set(new Set(readChecked(item.id)));
  }

  toggle(importId: string, key: string): void {
    const next = new Set(this.checked());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.checked.set(next);
    writeChecked(importId, [...next]);
  }

  private async refresh(): Promise<void> {
    const imp = this.current();
    if (!imp) return;
    try {
      const res = await firstValueFrom(this.http.get<ApiEnvelope<DataImport>>(API.importItem(imp.id)));
      if (this.current()?.id !== imp.id) return;
      this.current.set(res.data);
      if (!importRunning(res.data)) {
        this.history.reload();
        if (res.data.status === 'done') this.toast.success('Importação concluída', { message: importSummaryLine(res.data) });
        else this.toast.error('A importação falhou', { message: res.data.error ?? undefined });
      }
    } catch {
      /* rede instável: tenta de novo no próximo ciclo */
    }
  }
}
