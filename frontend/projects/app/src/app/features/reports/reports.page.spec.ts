import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { CreateReportBody, Me, Project, ReportSummary, ReportTemplate } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { resolvePreset } from '../../core/metrics/period';
import { suggestedTitle } from '../../core/reports/report-layout';
import { ReportsPage, groupByProject, suggestedTemplate } from './reports.page';

const me = (role: string): Me => ({
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const TEMPLATES: ReportTemplate[] = [
  { key: 'ecommerce', name: 'E-commerce', description: 'Vendas', niche: 'ecommerce', channels: [] },
  { key: 'restaurante_delivery', name: 'Restaurante e delivery', description: 'Pedidos', niche: 'restaurante_delivery', channels: [] },
  { key: 'redes_sociais', name: 'Redes sociais e marca', description: 'Orgânico', niche: 'outro', channels: [] },
];
const PROJECTS: Project[] = [
  { id: 'p1', name: 'Padaria Aurora', niche: 'restaurante_delivery', created_at: '' },
  { id: 'p2', name: 'Loja Boreal', niche: 'ecommerce', created_at: '' },
];
const report = (over: Partial<ReportSummary>): ReportSummary => ({
  id: 'r?',
  title: 'Relatório',
  project: { id: 'p1', name: 'Padaria Aurora', niche: 'restaurante_delivery' },
  template: null,
  period_preset: 'last_month',
  period_label: '01/10/2026 – 31/10/2026',
  updated_at: new Date().toISOString(),
  last_published_at: null,
  versions: 0,
  ...over,
});
const REPORTS = [
  report({ id: 'r1', title: 'Relatório de outubro', last_published_at: new Date().toISOString(), versions: 2 }),
  report({ id: 'r2', title: 'Mensal Boreal', project: { id: 'p2', name: 'Loja Boreal', niche: 'ecommerce' } }),
];

describe('helpers da lista de relatórios', () => {
  it('modelo sugerido pelo nicho e agrupamento por projeto', () => {
    expect(suggestedTemplate(TEMPLATES, 'ecommerce')).toBe('ecommerce');
    expect(suggestedTemplate(TEMPLATES, null)).toBe('redes_sociais');
    expect(groupByProject(REPORTS).map((g) => g.project.name)).toEqual(['Loja Boreal', 'Padaria Aurora']);
  });
});

describe('ReportsPage', () => {
  let fixture: ComponentFixture<ReportsPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
  }
  const button = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().startsWith(text));

  async function setup(role = 'owner', inputs: Record<string, string> = {}): Promise<void> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ReportsPage);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    el = fixture.nativeElement as HTMLElement;
    await tick();
  }

  async function loaded(inputs: Record<string, string> = {}): Promise<void> {
    await setup('owner', inputs);
    backend.expectOne('/api/reports').flush({ data: REPORTS });
    backend.expectOne('/api/projects').flush({ data: PROJECTS });
    backend.expectOne('/api/report-templates').flush({ data: TEMPLATES });
    await tick();
  }

  afterEach(() => backend.verify());

  it('cliente não vê o montador nem chama a API', async () => {
    await setup('client');
    backend.expectNone('/api/reports');
    expect(el.textContent).toContain('Os relatórios publicados ficam na página de cada projeto');
  });

  it('lista por projeto com período, publicação e versões; filtra por projeto', async () => {
    await loaded();
    const groups = [...el.querySelectorAll('.group')];
    expect(groups.map((g) => g.querySelector('h2')?.textContent?.trim())).toEqual(['Loja Boreal', 'Padaria Aurora']);
    expect(el.querySelector('[data-report="r1"]')?.textContent).toContain('2 versões');
    expect(el.querySelector('[data-report="r2"]')?.textContent).toContain('nunca publicado');

    const filter = el.querySelector<HTMLSelectElement>('select[name="filter_project"]')!;
    filter.value = 'p2';
    filter.dispatchEvent(new Event('change'));
    await tick();
    const req = backend.expectOne((r) => r.url === '/api/reports');
    expect(req.request.params.get('project_id')).toBe('p2');
    req.flush({ data: [REPORTS[1]] });
  });

  it('cria pelo modelo sugerido do nicho e abre o editor', async () => {
    await loaded();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    button('Novo relatório')!.click();
    await tick();

    const project = el.querySelector<HTMLSelectElement>('select[name="report_project"]')!;
    project.value = 'p1';
    project.dispatchEvent(new Event('change'));
    await tick();

    expect(el.querySelector('[data-template="restaurante_delivery"]')?.classList).toContain('is-checked');
    expect(el.querySelector('[data-template="restaurante_delivery"]')?.textContent).toContain('sugerido para Restaurante / delivery');
    expect(el.querySelector<HTMLInputElement>('input[name="report_title"]')!.value).toBe(suggestedTitle(resolvePreset('last_month')?.end));

    el.querySelector<HTMLFormElement>('form[aria-label="Novo relatório"]')!.dispatchEvent(new Event('submit'));
    await tick();
    const req = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/reports');
    expect(req.request.body as CreateReportBody).toEqual({
      project_id: 'p1',
      title: suggestedTitle(resolvePreset('last_month')?.end),
      period_preset: 'last_month',
      compare: 'previous_period',
      template: 'restaurante_delivery',
    });
    req.flush({ data: { ...REPORTS[0], id: 'r9' } }, { status: 201, statusText: 'Created' });
    await tick();
    expect(navigate).toHaveBeenCalledWith(['/relatorios', 'r9']);
  });

  it('?novo=<projeto> abre a criação já no projeto; exige projeto e mostra erro do servidor', async () => {
    await loaded({ novo: 'p2' });
    expect(el.querySelector<HTMLSelectElement>('select[name="report_project"]')!.value).toBe('p2');
    expect(el.querySelector('[data-template="ecommerce"]')?.classList).toContain('is-checked');

    const title = el.querySelector<HTMLInputElement>('input[name="report_title"]')!;
    title.value = 'X';
    title.dispatchEvent(new Event('input'));
    await tick();
    el.querySelector<HTMLFormElement>('form[aria-label="Novo relatório"]')!.dispatchEvent(new Event('submit'));
    await tick();
    backend.expectNone((r) => r.method === 'POST');
    expect(el.textContent).toContain('Dê um título ao relatório.');

    title.value = 'Relatório Boreal';
    title.dispatchEvent(new Event('input'));
    await tick();
    el.querySelector<HTMLFormElement>('form[aria-label="Novo relatório"]')!.dispatchEvent(new Event('submit'));
    await tick();
    backend
      .expectOne((r) => r.method === 'POST')
      .flush({ message: 'x', errors: { project_id: ['Projeto não encontrado.'] } }, { status: 422, statusText: 'Unprocessable' });
    await tick();
    expect(el.textContent).toContain('Projeto não encontrado.');
  });

  it('excluir pede confirmação', async () => {
    await loaded();
    const del = () => el.querySelector<HTMLButtonElement>('[data-report="r1"] button')!;
    del().click();
    await tick();
    backend.expectNone((r) => r.method === 'DELETE');
    expect(del().textContent).toContain('Excluir mesmo?');
    del().click();
    await tick();
    backend.expectOne((r) => r.method === 'DELETE' && r.url === '/api/reports/r1').flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    expect(el.querySelector('[data-report="r1"]')).toBeNull();
  });
});
