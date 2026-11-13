import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { Me, ReportFull, ReportLayout, SaveReportBody } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { UNSAVED_MESSAGE, unsavedChangesGuard } from '../../core/reports/unsaved-changes.guard';
import { PREVIEW_DEBOUNCE_MS, ReportEditorPage } from './report-editor.page';
import { REPORT_DATA } from './report-fixtures';

const ME: Me = {
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role: 'owner' }],
};

const LAYOUT: ReportLayout = {
  sections: [
    {
      id: 's1',
      title: 'Resumo',
      blocks: [
        { id: 'b1', type: 'text', title: 'Análise', content: 'Bom mês' },
        { id: 'b2', type: 'kpis', metrics: ['meta_ads:spend'] },
      ],
    },
    { id: 's2', title: 'Meta Ads', blocks: [{ id: 'b3', type: 'chart', metric: 'meta_ads:spend' }] },
  ],
};

const REPORT: ReportFull = {
  id: 'r1',
  title: 'Relatório de outubro',
  project: { id: 'p1', name: 'Padaria Aurora', niche: 'restaurante_delivery' },
  template: 'restaurante_delivery',
  period_preset: 'last_30',
  period_label: '13/10/2026 – 11/11/2026',
  updated_at: '2026-11-12T10:00:00Z',
  period_start: null,
  period_end: null,
  compare: 'previous_period',
  layout: LAYOUT,
  created_at: '2026-11-12T10:00:00Z',
};

const CATALOG = [
  { key: 'meta_ads:spend', provider: 'meta_ads', label: 'Investimento', description: '', unit: 'currency', kind: 'additive', direction: 'neutral', decimals: 2, featured: true },
  { key: 'meta_ads:cpm', provider: 'meta_ads', label: 'CPM', description: '', unit: 'currency', kind: 'derived', direction: 'lower_is_better', decimals: 2, featured: false },
];

describe('ReportEditorPage', () => {
  let fixture: ComponentFixture<ReportEditorPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let toast: DsToastService;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
  }
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const button = (text: string, scope: ParentNode = el) =>
    [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().startsWith(text));
  const structureRow = (id: string) => el.querySelector<HTMLButtonElement>(`.structure [data-block="${id}"]`)!;
  const inspector = () => el.querySelector<HTMLElement>('.inspector')!;

  async function setup(): Promise<void> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(ME), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(DsToastService);
    fixture = TestBed.createComponent(ReportEditorPage);
    fixture.componentRef.setInput('id', 'r1');
    el = fixture.nativeElement as HTMLElement;
    await tick();

    const req = backend.expectOne('/api/reports/r1');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    req.flush({ data: REPORT });
    backend.expectOne('/api/metrics/catalog').flush({ data: CATALOG });
    backend.expectOne('/api/providers').flush({
      data: [{ key: 'meta_ads', name: 'Meta Ads', category: 'ads', available_modes: ['sandbox'], metrics_count: 2, featured_metrics: [] }],
    });
    backend.expectOne('/api/custom-metrics').flush({ data: [] });
    backend.expectOne('/api/manual-metrics').flush({ data: [] });
    await tick();
    backend.expectOne('/api/projects/p1/accounts').flush({
      data: [{ id: 'a1', provider: 'meta_ads', name: 'Conta', kind: 'ad_account', currency: 'BRL', external_id: 'act_1' }],
    });
    await tick();
  }

  /** Espera o debounce e devolve a requisição da prévia (se houver). */
  async function previewRequest(): Promise<TestRequest> {
    await wait(PREVIEW_DEBOUNCE_MS + 50);
    TestBed.tick();
    return backend.expectOne((r) => r.method === 'POST' && r.url === '/api/reports/r1/render');
  }

  async function addBlock(sectionTitle: string, type: string): Promise<void> {
    el.querySelector<HTMLButtonElement>(`button[aria-label="Adicionar bloco em ${sectionTitle}"]`)!.click();
    await tick();
    el.querySelector<HTMLButtonElement>(`.add-option[data-type="${type}"]`)!.click();
    await tick();
  }

  afterEach(() => {
    backend.match((r) => r.url === '/api/reports/r1/render'); // prévias pendentes no fim do teste
    backend.verify();
  });

  it('escreve a análise com IA com o estado do editor e substitui o texto de análise ao inserir', async () => {
    await setup();
    const success = vi.spyOn(toast, 'success');

    button('Escrever análise com IA')!.click();
    await tick();
    backend.expectOne('/api/ai').flush({ data: { enabled: true, configured: true, source: 'agency', budget: 2000000, used_this_month: 0 } });
    await tick();

    const req = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/reports/r1/ai/analysis');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    expect(req.request.body).toEqual({ period_preset: 'last_30', period_start: null, period_end: null, compare: 'previous_period', layout: LAYOUT });
    req.flush({
      data: { text: 'Mês forte: investimento de R$ 1.200.', verified: false, unverified_numbers: ['R$ 1.200'], model: 'claude-opus-5-5', suggestion: true },
    });
    await tick();

    const dialog = el.querySelector<HTMLElement>('app-ai-analysis-dialog')!;
    expect(dialog.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    expect(dialog.querySelector('.unverified[role="alert"]')?.textContent).toContain('Estes números não batem com os dados');
    expect(dialog.querySelector('.nums')?.textContent).toContain('R$ 1.200');

    button('Inserir no relatório', dialog)!.click();
    await tick();

    expect(el.querySelector('app-ai-analysis-dialog')).toBeNull();
    expect(fixture.componentInstance.layout().sections[0].blocks[0]).toEqual({
      id: 'b1',
      type: 'text',
      title: 'Análise',
      content: 'Mês forte: investimento de R$ 1.200.',
    });
    expect(el.querySelector('.save-state')?.textContent).toContain('Alterações não salvas');
    expect(success).toHaveBeenCalledWith('Análise substituída', expect.objectContaining({ message: expect.stringContaining('Revise') }));
  });

  it('sem chave de IA, o diálogo explica e leva o dono a Configurações › IA (sem pedir a análise)', async () => {
    await setup();

    button('Escrever análise com IA')!.click();
    await tick();
    backend.expectOne('/api/ai').flush({ data: { enabled: true, configured: false, source: null, budget: 2000000, used_this_month: 0 } });
    await tick();

    backend.expectNone((r) => r.url === '/api/reports/r1/ai/analysis');
    const empty = el.querySelector('[data-testid="ai-empty"]');
    expect(empty?.textContent).toContain('ainda não tem uma chave');
    expect(empty?.querySelector('a')?.getAttribute('href')).toBe('/configuracoes/ia');
  });

  it('mostra a mensagem do copiloto quando ele não responde (422) e deixa tentar de novo', async () => {
    await setup();

    button('Escrever análise com IA')!.click();
    await tick();
    backend.expectOne('/api/ai').flush({ data: { enabled: true, configured: true, source: 'server', budget: 2000000, used_this_month: 0 } });
    await tick();
    backend.expectOne('/api/reports/r1/ai/analysis').flush(
      { message: 'O orçamento acabou.', errors: { ai: ['O orçamento de IA da agência para este mês acabou.'] } },
      { status: 422, statusText: 'Unprocessable Content' },
    );
    await tick();

    const dialog = el.querySelector<HTMLElement>('app-ai-analysis-dialog')!;
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('O orçamento de IA da agência para este mês acabou.');
    button('Tentar de novo', dialog)!.click();
    await tick();
    backend.expectOne('/api/reports/r1/ai/analysis').flush({
      data: { text: 'Tudo certo.', verified: true, unverified_numbers: [], model: 'claude-opus-5-5', suggestion: true },
    });
    await tick();
    expect(dialog.querySelector('.unverified')).toBeNull();
    expect(dialog.querySelector('[data-testid="ai-text"]')?.textContent).toContain('Tudo certo.');

    button('Descartar', dialog)!.click();
    await tick();
    expect(el.querySelector('app-ai-analysis-dialog')).toBeNull();
    expect(fixture.componentInstance.layout()).toEqual(LAYOUT);
  });

  it('carrega o relatório e mostra a prévia com dados reais, uma vez por rajada de edições', async () => {
    await setup();
    expect((el.querySelector('#report-title') as HTMLInputElement).value).toBe('Relatório de outubro');
    expect(el.querySelector('.save-state')?.textContent).toContain('Tudo salvo');

    // duas edições seguidas: uma prévia só
    const title = el.querySelector<HTMLInputElement>('#report-title')!;
    title.value = 'Relatório mensal';
    title.dispatchEvent(new Event('input'));
    await tick();
    title.value = 'Relatório mensal de outubro';
    title.dispatchEvent(new Event('input'));
    await tick();

    const req = await previewRequest();
    const body = req.request.body as SaveReportBody;
    expect(body.title).toBe('Relatório mensal de outubro');
    expect(body.period_preset).toBe('last_30');
    expect(body.layout.sections.map((s) => s.id)).toEqual(['s1', 's2']);
    req.flush({ data: REPORT_DATA });
    await tick();

    expect(el.querySelector('app-report-view .cover')?.textContent).toContain('Relatório de outubro');
    expect(el.querySelector('.save-state')?.textContent).toContain('Alterações não salvas');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
  });

  it('adiciona, edita, move e remove blocos; salva e volta a "Tudo salvo"', async () => {
    await setup();
    await addBlock('Resumo', 'table');

    const added = fixture.componentInstance.layout().sections[0].blocks[2];
    expect(added.type).toBe('table');
    expect(fixture.componentInstance.selectedId()).toBe(added.id);
    expect(inspector().textContent).toContain('Tabela');
    expect(structureRow(added.id).textContent).toContain('escolha as métricas');

    // escolhe métricas no inspetor
    inspector().querySelector<HTMLInputElement>('app-metric-picker input[value="meta_ads:cpm"]')!.click();
    await tick();
    expect(structureRow(added.id).textContent).toContain('CPM');

    // sobe o bloco
    button('↑ Subir', inspector())!.click();
    await tick();
    expect(fixture.componentInstance.layout().sections[0].blocks.map((b) => b.id)).toEqual(['b1', added.id, 'b2']);

    // remover pede confirmação
    button('Remover bloco', inspector())!.click();
    await tick();
    expect(fixture.componentInstance.layout().sections[0].blocks).toHaveLength(3);
    button('Confirmar remoção', inspector())!.click();
    await tick();
    expect(fixture.componentInstance.layout().sections[0].blocks.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(el.querySelector('.save-state')?.textContent).toContain('Tudo salvo'); // voltou ao salvo

    // muda e salva
    await addBlock('Meta Ads', 'attention');
    button('Salvar')!.click();
    await tick();
    const put = backend.expectOne((r) => r.method === 'PUT' && r.url === '/api/reports/r1');
    const body = put.request.body as SaveReportBody;
    expect(body.layout.sections[1].blocks.map((b) => b.type)).toEqual(['chart', 'attention']);
    put.flush({ data: { ...REPORT, layout: body.layout } });
    await tick();
    expect(el.querySelector('.save-state')?.textContent).toContain('Tudo salvo');
  });

  it('não salva com bloco incompleto e aponta o bloco', async () => {
    await setup();
    const error = vi.spyOn(toast, 'error');
    await addBlock('Meta Ads', 'kpis');
    const id = fixture.componentInstance.selectedId()!;

    button('Salvar')!.click();
    await tick();

    backend.expectNone((r) => r.method === 'PUT');
    expect(error).toHaveBeenCalled();
    expect(el.querySelector(`.structure [data-block="${id}"]`)?.closest('li')?.querySelector('.row-error')?.textContent).toContain(
      'Escolha ao menos uma métrica.',
    );
  });

  it('Ctrl+S salva e os erros 422 aparecem no bloco certo', async () => {
    await setup();
    const title = el.querySelector<HTMLInputElement>('#report-title')!;
    title.value = 'Outro título';
    title.dispatchEvent(new Event('input'));
    await tick();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }));
    await tick();
    backend
      .expectOne((r) => r.method === 'PUT' && r.url === '/api/reports/r1')
      .flush(
        { message: 'Dados inválidos', errors: { 'layout.sections.0.blocks.1.metrics': ['Métrica desconhecida: meta_ads:spend.'], period_end: ['Os dados vão até ontem.'] } },
        { status: 422, statusText: 'Unprocessable' },
      );
    await tick();

    expect(fixture.componentInstance.selectedId()).toBe('b2');
    expect(structureRow('b2').closest('li')?.querySelector('.row-error')?.textContent).toContain('Métrica desconhecida');
    expect(inspector().querySelector('.field-error')?.textContent).toContain('Métrica desconhecida');
    expect(el.querySelector('app-period-picker .error')?.textContent).toContain('Os dados vão até ontem.');
    expect(el.querySelector('.save-state')?.textContent).toContain('Alterações não salvas');
  });

  it('publicar salva antes e abre as versões publicadas', async () => {
    await setup();
    const success = vi.spyOn(toast, 'success');
    const title = el.querySelector<HTMLInputElement>('#report-title')!;
    title.value = 'Novo título';
    title.dispatchEvent(new Event('input'));
    await tick();

    button('Publicar')!.click();
    await tick();
    const put = backend.expectOne((r) => r.method === 'PUT');
    put.flush({ data: { ...REPORT, title: 'Novo título' } });
    await tick();
    const post = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/reports/r1/snapshots');
    post.flush(
      {
        data: {
          id: 'v1', report_id: 'r1', project_id: 'p1', title: 'Novo título', period: { start: '2026-10-13', end: '2026-11-11' },
          comparison: null, pdf_status: 'pending', pdf_error: null, active_links: 0, created_at: '2026-11-12T10:00:00Z', data: REPORT_DATA,
        },
      },
      { status: 201, statusText: 'Created' },
    );
    await tick();

    expect(success).toHaveBeenCalledWith('Versão publicada', expect.any(Object));
    expect(el.querySelector('.tab[aria-selected="true"]')?.textContent).toContain('Versões publicadas');
    backend.expectOne('/api/reports/r1/snapshots').flush({ data: [] });
    await tick();
    expect(el.querySelector('app-report-versions')?.textContent).toContain('Nenhuma versão publicada');
  });

  it('o guard pergunta antes de sair com alterações não salvas', () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const guard = (dirty: boolean) =>
      TestBed.runInInjectionContext(() =>
        unsavedChangesGuard({ hasUnsavedChanges: () => dirty }, null as never, null as never, null as never),
      );
    expect(guard(false)).toBe(true);
    expect(guard(true)).toBe(false);
    expect(ask).toHaveBeenCalledWith(UNSAVED_MESSAGE);
  });
});
