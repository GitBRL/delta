import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DsButton, DsGlassCard, DsIcon, DsSkeleton, DsTextField, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  Account,
  ApiEnvelope,
  ConnectionMode,
  CustomMetric,
  ManualMetric,
  MetricDefinition,
  Project,
  Provider,
  SheetSync,
  SheetSyncDetail,
  SyncDestination,
  SyncDestinationList,
  TENANT_HEADER,
} from '../../core/api/api.types';
import { relativeTime } from '../../core/format/relative-time';
import { FieldErrors, extractFieldErrors, validationMessage } from '../../core/forms/server-errors';
import { OAuthFlow, OAuthService } from '../../core/oauth/oauth.service';
import { pollWhile } from '../../core/polling/poll-while';
import { metricOptions } from '../../core/reports/report-metrics';
import { TenantService } from '../../core/tenant/tenant.service';
import { MetricPicker } from '../reports/metric-picker';
import {
  FREQUENCY_TEXT,
  SYNC_DAY_PRESETS,
  SYNC_LIMITS,
  SYNC_POLL_MS,
  SyncDraft,
  destinationModeText,
  emptySyncDraft,
  previewCell,
  scheduleText,
  syncBody,
  syncDraftFrom,
  syncStatus,
  validateSyncDraft,
} from './sync';

/**
 * Sync (ADR 0027): exportação agendada das métricas de um projeto para uma planilha do Google.
 * Uma linha por dia, uma coluna por métrica. Só a equipe da agência. O destino é conectado pelo
 * mesmo login em pop-up das Integrações (provider "google_sheets", escopo drive.file).
 */
@Component({
  selector: 'app-sync-page',
  imports: [FormsModule, RouterLink, DsButton, DsGlassCard, DsIcon, DsSkeleton, DsTextField, MetricPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-8">
      <h1 class="m-0 text-large-title font-bold tracking-tight">Sync</h1>
      <p class="m-0 mt-2 max-w-2xl text-subhead text-fg-muted">
        Exporte as métricas dos projetos para o Google Sheets, todo dia ou toda semana, para cruzar com o financeiro, montar o
        seu BI ou repassar ao cliente.
      </p>
    </header>

    @if (!isStaff()) {
      <ds-glass-card padding="lg" role="note">
        <p class="m-0 text-headline">O Sync é da equipe da agência.</p>
      </ds-glass-card>
    } @else {
      <div class="col">
        <!-- Destinos -->
        <ds-glass-card padding="lg" data-testid="destinations">
          <div class="head">
            <span class="icon" aria-hidden="true"><svg dsIcon="table" [size]="20"></svg></span>
            <div class="min-w-0 flex-1">
              <h2 class="m-0 text-headline">Destinos Google Sheets</h2>
              <p class="m-0 text-footnote text-fg-muted">O Delta só acessa as planilhas que ele mesmo criar, nada mais do seu Drive.</p>
            </div>
          </div>

          @if (destinations.isLoading() && !destinations.hasValue()) {
            <div class="mt-4"><ds-skeleton width="50%" /></div>
          } @else if (destinations.error()) {
            <p class="m-0 mt-4 text-footnote" role="alert">Não foi possível carregar os destinos.</p>
          } @else {
            <ul class="list" aria-label="Destinos conectados">
              @for (d of destinationList(); track d.id) {
                <li class="row">
                  <div class="min-w-0 flex-1">
                    <strong class="text-subhead">{{ d.label }}</strong>
                    <p class="m-0 text-caption text-fg-muted">{{ modeText(d.mode) }} · conectado {{ ago(d.created_at) }}</p>
                  </div>
                  @if (confirm() === 'dest:' + d.id) {
                    <span class="text-footnote">Remover? As exportações deste destino também são removidas.</span>
                    <button ds-button variant="ghost" size="sm" (click)="confirm.set(null)">Cancelar</button>
                    <button ds-button variant="destructive" size="sm" [loading]="busy() === 'dest:' + d.id" (click)="removeDestination(d)">Remover</button>
                  } @else {
                    <button ds-button variant="ghost" size="sm" (click)="confirm.set('dest:' + d.id)" [attr.aria-label]="'Remover o destino ' + d.label">Remover</button>
                  }
                </li>
              } @empty {
                <li class="empty text-footnote text-fg-muted">Nenhum destino conectado ainda.</li>
              }
            </ul>

            <div class="actions mt-4">
              @if (pending(); as p) {
                <span class="text-footnote" role="status">Autorizando na outra janela…</span>
                <button ds-button variant="ghost" size="sm" (click)="p.cancel()">Cancelar</button>
              } @else {
                @if (canLive()) {
                  <button ds-button (click)="connect('live')"><svg dsIcon="plus" [size]="14"></svg> Conectar conta Google</button>
                }
                <button ds-button [variant]="canLive() ? 'secondary' : 'primary'" (click)="connect('sandbox')">Conectar em demonstração</button>
              }
            </div>
            @if (liveNote(); as note) {
              <p class="m-0 mt-2 text-footnote text-fg-muted" data-testid="live-note">{{ note }}</p>
            }
          }
        </ds-glass-card>

        <!-- Exportações -->
        <section aria-labelledby="exports-title">
          <div class="section-head">
            <h2 id="exports-title" class="m-0 text-title-3 font-semibold">Exportações</h2>
            @if (!draft()) {
              <button ds-button size="sm" (click)="newSync()" [disabled]="destinationList().length === 0">
                <svg dsIcon="plus" [size]="14"></svg> Nova exportação
              </button>
            }
          </div>
          @if (!draft() && destinationList().length === 0 && destinations.hasValue()) {
            <p class="m-0 mt-1 text-footnote text-fg-muted">Conecte um destino Google Sheets para criar a primeira exportação.</p>
          }

          @if (draft(); as d) {
            <ds-glass-card padding="lg" class="mt-4" data-testid="sync-form">
              <h3 class="m-0 text-headline">{{ d.id ? 'Editar exportação' : 'Nova exportação' }}</h3>
              <form class="form" (submit)="$event.preventDefault(); save()" novalidate aria-label="Exportação para Google Sheets">
                @if (!d.id) {
                  <label class="field">
                    <span class="label">Projeto</span>
                    <select name="project_id" [value]="d.project_id" (change)="patch({ project_id: $any($event.target).value })">
                      <option value="">Escolha…</option>
                      @for (p of projectList(); track p.id) {
                        <option [value]="p.id" [selected]="p.id === d.project_id">{{ p.name }}</option>
                      }
                    </select>
                    @if (errors()['project_id']) {
                      <small class="error" role="alert">{{ errors()['project_id'] }}</small>
                    }
                  </label>
                  <label class="field">
                    <span class="label">Destino</span>
                    <select name="connection_id" [value]="d.connection_id" (change)="patch({ connection_id: $any($event.target).value })">
                      <option value="">Escolha…</option>
                      @for (dest of destinationList(); track dest.id) {
                        <option [value]="dest.id" [selected]="dest.id === d.connection_id">{{ dest.label }}</option>
                      }
                    </select>
                    @if (errors()['connection_id']) {
                      <small class="error" role="alert">{{ errors()['connection_id'] }}</small>
                    }
                  </label>
                } @else {
                  <p class="m-0 text-footnote text-fg-muted">Projeto e destino não mudam depois de criada a exportação.</p>
                }

                <ds-text-field label="Nome" name="name" placeholder="Ex.: Mídia diária" [maxlength]="120" [ngModel]="d.name" (ngModelChange)="patch({ name: $event })" [error]="errors()['name'] ?? null" />

                <div class="field">
                  <span class="label">Métricas (uma coluna cada)</span>
                  <app-metric-picker [options]="options()" [max]="limits.maxMetrics" [selected]="d.metrics" (selectedChange)="patch({ metrics: $event })" />
                  @if (errors()['metrics']) {
                    <small class="error" role="alert">{{ errors()['metrics'] }}</small>
                  }
                </div>

                <fieldset class="field">
                  <legend class="label">Janela (dias até ontem)</legend>
                  <div class="chips">
                    @for (n of presets; track n) {
                      <button type="button" class="chip-btn" [class.on]="d.days === '' + n" [attr.aria-pressed]="d.days === '' + n" (click)="patch({ days: '' + n })">{{ n }} dias</button>
                    }
                  </div>
                  <ds-text-field label="Ou outro número de dias" name="days" inputmode="numeric" [hint]="'De ' + limits.minDays + ' a ' + limits.maxDays + '.'" [ngModel]="d.days" (ngModelChange)="patch({ days: $event })" [error]="errors()['days'] ?? null" />
                </fieldset>

                <fieldset class="field">
                  <legend class="label">Frequência</legend>
                  <div class="chips">
                    @for (f of frequencies; track f.key) {
                      <label class="radio">
                        <input type="radio" name="frequency" [value]="f.key" [checked]="d.frequency === f.key" (change)="patch({ frequency: f.key })" />
                        <span>{{ f.text }}</span>
                      </label>
                    }
                  </div>
                </fieldset>

                <div class="actions">
                  <button ds-button type="button" variant="ghost" (click)="cancelDraft()">Cancelar</button>
                  <button ds-button type="submit" [loading]="saving()" [disabled]="saving()">{{ d.id ? 'Salvar' : 'Criar e rodar' }}</button>
                </div>
              </form>
            </ds-glass-card>
          }

          @if (syncs.isLoading() && !syncs.hasValue()) {
            <ds-glass-card padding="lg" class="mt-4"><ds-skeleton width="60%" /><ds-skeleton width="40%" /></ds-glass-card>
          } @else if (syncs.error()) {
            <ds-glass-card padding="lg" class="mt-4" role="alert">
              <p class="m-0">Não foi possível carregar as exportações.</p>
              <button ds-button variant="secondary" size="sm" class="mt-3" (click)="syncs.reload()">Tentar de novo</button>
            </ds-glass-card>
          } @else if (syncList().length === 0 && !draft()) {
            <ds-glass-card padding="lg" class="mt-4" data-testid="sync-empty">
              <p class="m-0 text-headline">Nenhuma exportação ainda.</p>
              <p class="m-0 mt-2 text-footnote text-fg-muted">
                Cada dia vira uma linha e cada métrica uma coluna, numa planilha nova criada pelo Delta. A cada execução a aba
                “Dados” é atualizada com a janela escolhida. O Delta só acessa as planilhas que ele mesmo criar.
              </p>
            </ds-glass-card>
          } @else {
            <ul class="syncs" aria-label="Exportações">
              @for (s of syncList(); track s.id) {
                @let st = status(s);
                <li>
                  <ds-glass-card padding="md" class="sync" [attr.data-id]="s.id">
                    <div class="sync-head">
                      <div class="min-w-0 flex-1">
                        <strong class="text-headline">{{ s.name }}</strong>
                        <p class="m-0 text-footnote text-fg-muted">
                          {{ s.project?.name ?? '—' }} → {{ s.destination?.label ?? 'destino removido' }}
                        </p>
                        <p class="m-0 text-caption text-fg-muted">
                          {{ schedule(s) }} · {{ s.metrics.length }} {{ s.metrics.length === 1 ? 'métrica' : 'métricas' }} · última execução {{ ago(s.last_run_at) }}
                        </p>
                      </div>
                      <span class="status" [attr.data-tone]="st.tone" role="status">{{ st.text }}</span>
                    </div>
                    @if (s.last_status === 'error' && s.last_error) {
                      <p class="m-0 err text-footnote" role="alert">{{ s.last_error }}</p>
                    }
                    <div class="actions">
                      @if (s.spreadsheet_url) {
                        <a ds-button variant="secondary" size="sm" [href]="s.spreadsheet_url" target="_blank" rel="noopener noreferrer">Abrir planilha</a>
                      }
                      @if (s.destination?.mode === 'sandbox' && s.has_preview) {
                        <button ds-button variant="secondary" size="sm" (click)="togglePreview(s)" [attr.aria-expanded]="previewOf() === s.id">
                          {{ previewOf() === s.id ? 'Fechar prévia' : 'Ver prévia' }}
                        </button>
                      }
                      <button ds-button variant="ghost" size="sm" (click)="run(s)" [loading]="busy() === 'run:' + s.id" [disabled]="busy() !== null || !s.active || s.last_status === 'running'">Rodar agora</button>
                      <button ds-button variant="ghost" size="sm" (click)="toggleActive(s)" [loading]="busy() === 'active:' + s.id" [disabled]="busy() !== null">{{ s.active ? 'Pausar' : 'Ativar' }}</button>
                      <button ds-button variant="ghost" size="sm" (click)="edit(s)" [disabled]="busy() !== null">Editar</button>
                      @if (confirm() === 'sync:' + s.id) {
                        <button ds-button variant="ghost" size="sm" (click)="confirm.set(null)">Cancelar</button>
                        <button ds-button variant="destructive" size="sm" [loading]="busy() === 'remove:' + s.id" (click)="remove(s)">Remover</button>
                      } @else {
                        <button ds-button variant="ghost" size="sm" (click)="confirm.set('sync:' + s.id)" [attr.aria-label]="'Remover a exportação ' + s.name">Remover</button>
                      }
                    </div>

                    @if (previewOf() === s.id) {
                      @if (preview(); as p) {
                        <div class="preview" data-testid="preview">
                          <p class="m-0 text-caption text-fg-muted">
                            Prévia da demonstração: {{ p.rows.length - 1 }} de {{ p.total_rows }} dias (nada foi enviado ao Google).
                          </p>
                          <div class="table-wrap" tabindex="0" role="region" aria-label="Prévia da planilha">
                            <table>
                              <thead>
                                <tr>
                                  @for (h of p.rows[0]; track $index) {
                                    <th scope="col">{{ h }}</th>
                                  }
                                </tr>
                              </thead>
                              <tbody>
                                @for (row of p.rows.slice(1); track $index) {
                                  <tr>
                                    @for (cell of row; track $index) {
                                      <td>{{ fmtCell(cell) }}</td>
                                    }
                                  </tr>
                                }
                              </tbody>
                            </table>
                          </div>
                        </div>
                      } @else if (loadingPreview()) {
                        <div class="preview"><ds-skeleton width="80%" /></div>
                      } @else {
                        <p class="m-0 text-footnote text-fg-muted">Sem prévia ainda: rode a exportação.</p>
                      }
                    }
                  </ds-glass-card>
                </li>
              }
            </ul>
          }
        </section>

        <p class="m-0 text-footnote text-fg-muted">
          Para o login real com uma conta Google, um dono ou administrador cadastra o app do Google em
          <a routerLink="/integracoes/apps">Integrações › Apps das plataformas</a>.
        </p>
      </div>
    }
  `,
  styles: `
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-6);
      max-width: 880px;
    }
    .head {
      display: flex;
      align-items: center;
      gap: var(--ds-space-3);
    }
    .icon {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: color-mix(in oklch, var(--ds-accent) 14%, transparent);
      color: var(--ds-accent);
    }
    .list {
      display: flex;
      flex-direction: column;
      margin: var(--ds-space-4) 0 0;
      padding: 0;
      list-style: none;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
      padding: var(--ds-space-3) 0;
      border-bottom: 1px solid var(--ds-separator);
    }
    .empty {
      padding: var(--ds-space-3) 0;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-2);
    }
    .section-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-3);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4);
      margin-top: var(--ds-space-4);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .label {
      padding: 0;
      font: var(--ds-text-footnote);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    select {
      height: 40px;
      padding: 0 10px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      font: var(--ds-text-subhead);
    }
    .error {
      font: var(--ds-text-caption);
      color: var(--ds-status-critical);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ds-space-2);
    }
    .chip-btn {
      padding: 6px 12px;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-full);
      background: transparent;
      color: var(--ds-text);
      font: var(--ds-text-footnote);
      cursor: pointer;
    }
    .chip-btn.on {
      border-color: var(--ds-accent);
      background: color-mix(in oklch, var(--ds-accent) 14%, transparent);
      color: var(--ds-accent);
      font-weight: 600;
    }
    .radio {
      display: flex;
      align-items: center;
      gap: 6px;
      font: var(--ds-text-subhead);
    }
    .syncs {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
      margin: var(--ds-space-4) 0 0;
      padding: 0;
      list-style: none;
    }
    .sync {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3);
    }
    .sync-head {
      display: flex;
      align-items: flex-start;
      gap: var(--ds-space-3);
    }
    .status {
      flex: none;
      padding: 2px 10px;
      border-radius: var(--ds-radius-full);
      background: var(--ds-fill);
      color: var(--ds-text-secondary);
      font: var(--ds-text-caption);
      font-weight: 600;
    }
    .status[data-tone='ok'] {
      background: color-mix(in oklch, var(--ds-status-healthy) 16%, transparent);
      color: var(--ds-status-healthy);
    }
    .status[data-tone='error'] {
      background: color-mix(in oklch, var(--ds-status-critical) 14%, transparent);
      color: var(--ds-status-critical);
    }
    .status[data-tone='running'] {
      background: color-mix(in oklch, var(--ds-accent) 14%, transparent);
      color: var(--ds-accent);
    }
    .err {
      padding: var(--ds-space-2) var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: color-mix(in oklch, var(--ds-status-critical) 10%, transparent);
      color: var(--ds-status-critical);
    }
    .preview {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font: var(--ds-text-caption);
      font-variant-numeric: tabular-nums;
    }
    th,
    td {
      padding: 6px 10px;
      border-bottom: 1px solid var(--ds-separator);
      text-align: right;
      white-space: nowrap;
    }
    th:first-child,
    td:first-child {
      text-align: left;
    }
    th {
      background: var(--ds-fill);
      font-weight: 600;
    }
  `,
})
export class SyncPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  private readonly oauth = inject(OAuthService);
  protected readonly tenant = inject(TenantService);

  protected readonly limits = SYNC_LIMITS;
  protected readonly presets = SYNC_DAY_PRESETS;
  protected readonly frequencies = (['daily', 'weekly'] as const).map((key) => ({ key, text: FREQUENCY_TEXT[key] }));
  protected readonly ago = relativeTime;
  protected readonly modeText = destinationModeText;
  protected readonly schedule = scheduleText;
  protected readonly status = syncStatus;
  protected readonly fmtCell = previewCell;

  protected readonly isStaff = computed(() => !!this.tenant.current() && this.tenant.current()?.role !== 'client');
  private readonly staffRequest = (url: string) => {
    const tenantId = this.tenant.currentId();
    return tenantId && this.isStaff() ? { url, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  };

  /* ---------- Dados ---------- */
  readonly destinations = httpResource<SyncDestinationList>(() => this.staffRequest(API.syncDestinations));
  readonly syncs = httpResource<ApiEnvelope<SheetSync[]>>(() => this.staffRequest(API.sheetSyncs));
  protected readonly destinationList = computed(() => (this.destinations.hasValue() ? this.destinations.value().data : []));
  protected readonly syncList = computed(() => (this.syncs.hasValue() ? this.syncs.value().data : []));
  protected readonly canLive = computed(() => this.destinations.hasValue() && this.destinations.value().meta.modes.includes('live'));
  protected readonly liveNote = computed(() => (this.destinations.hasValue() ? this.destinations.value().meta.live_note : null));
  private readonly running = computed(() => this.syncList().some((s) => s.last_status === 'running'));

  /* Formulário: projetos e métricas só carregam quando ele abre. */
  readonly draft = signal<SyncDraft | null>(null);
  readonly errors = signal<FieldErrors>({});
  readonly saving = signal(false);
  private readonly formOpen = computed(() => this.draft() !== null);
  readonly projects = httpResource<ApiEnvelope<Project[]>>(() => (this.formOpen() ? this.staffRequest(API.projects) : undefined));
  protected readonly projectList = computed(() => (this.projects.hasValue() ? this.projects.value().data : []));
  private readonly catalog = httpResource<ApiEnvelope<MetricDefinition[]>>(() => (this.formOpen() ? API.metricsCatalog : undefined));
  private readonly providers = httpResource<ApiEnvelope<Provider[]>>(() => (this.formOpen() ? this.staffRequest(API.providers) : undefined));
  private readonly customs = httpResource<ApiEnvelope<CustomMetric[]>>(() => (this.formOpen() ? this.staffRequest(API.customMetrics) : undefined));
  private readonly manuals = httpResource<ApiEnvelope<ManualMetric[]>>(() => (this.formOpen() ? this.staffRequest(API.manualMetrics) : undefined));
  private readonly draftProject = computed(() => this.draft()?.project_id || null);
  private readonly linked = httpResource<ApiEnvelope<Account[]>>(() => {
    const projectId = this.draftProject();
    return projectId ? this.staffRequest(API.projectAccounts(projectId)) : undefined;
  });
  protected readonly options = computed(() =>
    metricOptions(
      this.catalog.hasValue() ? this.catalog.value().data : [],
      this.providers.hasValue() ? this.providers.value().data : [],
      this.customs.hasValue() ? this.customs.value().data : [],
      this.linked.hasValue() ? this.linked.value().data.map((a) => a.provider) : [],
      this.manuals.hasValue() ? this.manuals.value().data : [],
    ),
  );

  /* Ações */
  readonly pending = signal<OAuthFlow | null>(null);
  readonly confirm = signal<string | null>(null);
  readonly busy = signal<string | null>(null);
  readonly previewOf = signal<string | null>(null);
  readonly preview = signal<SheetSyncDetail['preview']>(null);
  readonly loadingPreview = signal(false);

  constructor() {
    // A primeira execução roda logo depois de criar; a lista acompanha até terminar.
    pollWhile(
      () => this.running(),
      () => {
        if (!this.syncs.isLoading()) this.syncs.reload();
      },
      SYNC_POLL_MS,
    );
    inject(DestroyRef).onDestroy(() => this.pending()?.dispose());
  }

  /* ---------- Destinos ---------- */

  /** Síncrono no clique: window.open fora do gesto é bloqueado pelo navegador. */
  connect(mode: ConnectionMode): void {
    const tenantId = this.tenant.currentId();
    if (!tenantId || this.pending()) return;
    const flow = this.oauth.start({ provider: 'google_sheets', tenantId, mode });
    if (flow.via === 'redirect') return;

    this.pending.set(flow);
    void flow.result.then((outcome) => {
      if (this.pending() !== flow) return;
      this.pending.set(null);
      switch (outcome.status) {
        case 'success':
          this.destinations.reload();
          this.toast.success('Google Sheets conectado', {
            message: mode === 'sandbox' ? 'Destino de demonstração: as exportações geram só a prévia.' : 'As planilhas serão criadas nesta conta.',
          });
          break;
        case 'error':
          this.toast.error('Não foi possível conectar o Google Sheets', { message: outcome.message });
          break;
        case 'timeout':
          this.toast.info('O tempo para autorizar acabou', { message: 'Tente de novo.' });
          break;
        default:
          break; // cancelado: nada a fazer
      }
    });
  }

  async removeDestination(d: SyncDestination): Promise<void> {
    await this.act(`dest:${d.id}`, async () => {
      await firstValueFrom(this.http.delete(API.syncDestination(d.id)));
      this.confirm.set(null);
      this.destinations.reload();
      this.syncs.reload();
      this.toast.success('Destino removido');
    });
  }

  /* ---------- Formulário ---------- */

  newSync(): void {
    this.errors.set({});
    this.draft.set(emptySyncDraft(this.destinationList()));
  }

  edit(s: SheetSync): void {
    this.errors.set({});
    this.draft.set(syncDraftFrom(s));
  }

  cancelDraft(): void {
    this.draft.set(null);
    this.errors.set({});
  }

  patch(change: Partial<SyncDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
  }

  async save(): Promise<void> {
    const d = this.draft();
    if (!d || this.saving()) return;
    const errors = validateSyncDraft(d);
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) return;

    this.saving.set(true);
    try {
      if (d.id === null) {
        await firstValueFrom(this.http.post(API.sheetSyncs, syncBody(d)));
        this.toast.success('Exportação criada', { message: 'A primeira execução já começou.' });
      } else {
        await firstValueFrom(this.http.patch(API.sheetSync(d.id), syncBody(d)));
        this.toast.success('Exportação salva');
      }
      this.draft.set(null);
      this.syncs.reload();
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields && Object.keys(fields).length > 0) {
        this.errors.set(fields);
      } else {
        this.toast.error('Não foi possível salvar a exportação', { message: validationMessage(error) ?? 'Tente de novo em instantes.' });
      }
    } finally {
      this.saving.set(false);
    }
  }

  /* ---------- Exportações ---------- */

  async run(s: SheetSync): Promise<void> {
    await this.act(`run:${s.id}`, async () => {
      await firstValueFrom(this.http.post(API.sheetSyncRun(s.id), {}));
      this.syncs.reload();
      if (this.previewOf() === s.id) this.previewOf.set(null);
      this.toast.success('Exportação em andamento');
    });
  }

  async toggleActive(s: SheetSync): Promise<void> {
    await this.act(`active:${s.id}`, async () => {
      await firstValueFrom(this.http.patch(API.sheetSync(s.id), { active: !s.active }));
      this.syncs.reload();
      this.toast.success(s.active ? 'Exportação pausada' : 'Exportação ativada');
    });
  }

  async remove(s: SheetSync): Promise<void> {
    await this.act(`remove:${s.id}`, async () => {
      await firstValueFrom(this.http.delete(API.sheetSync(s.id)));
      this.confirm.set(null);
      if (this.previewOf() === s.id) this.previewOf.set(null);
      this.syncs.reload();
      this.toast.success('Exportação removida', { message: 'A planilha continua no seu Drive.' });
    });
  }

  async togglePreview(s: SheetSync): Promise<void> {
    if (this.previewOf() === s.id) {
      this.previewOf.set(null);
      return;
    }
    this.previewOf.set(s.id);
    this.preview.set(null);
    this.loadingPreview.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiEnvelope<SheetSyncDetail>>(API.sheetSync(s.id)));
      if (this.previewOf() === s.id) this.preview.set(res.data.preview);
    } catch {
      this.toast.error('Não foi possível carregar a prévia');
    } finally {
      this.loadingPreview.set(false);
    }
  }

  private async act(key: string, action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(key);
    try {
      await action();
    } catch (error) {
      const fields = extractFieldErrors(error);
      const message = fields ? (Object.values(fields)[0] ?? validationMessage(error)) : null;
      if (!(error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500 || error.status === 403))) {
        this.toast.error('Não foi possível concluir', { message: message ?? 'Tente de novo em instantes.' });
      }
    } finally {
      this.busy.set(null);
    }
  }
}
