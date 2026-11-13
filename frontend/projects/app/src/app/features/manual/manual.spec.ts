import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ManualMetric, Me } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { changedEntries, monthDays, monthTotal, parseCell } from './manual';
import { ManualMetricsPage } from './manual-metrics.page';
import { ProjectManualValues } from './project-manual-values';

const ME: Me = {
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role: 'owner' }],
};

const SALES: ManualMetric = {
  id: 'mm1',
  key: 'manual:vendas_na_loja',
  name: 'Vendas na loja',
  description: null,
  unit: 'currency',
  direction: 'higher_is_better',
  decimals: 2,
  aggregation: 'sum',
  created_at: '2026-11-01T10:00:00Z',
};

describe('helpers de dados manuais', () => {
  it('dias do mês, números pt-BR e total por agregação', () => {
    expect(monthDays('2026-02')).toHaveLength(28);
    expect(monthDays('2026-11')[29]).toBe('2026-11-30');
    expect(parseCell('1.234,56')).toBe(1234.56);
    expect(parseCell('R$ 10')).toBe(10);
    expect(parseCell('')).toBeNull();
    expect(parseCell('abc')).toBeNaN();

    const values = new Map([['2026-11-01', 100], ['2026-11-03', 50]]);
    const days = monthDays('2026-11');
    expect(monthTotal(values, days, 'sum')).toBe(150);
    expect(monthTotal(values, days, 'last')).toBe(50);
    expect(monthTotal(new Map(), days, 'sum')).toBeNull();
  });

  it('só manda o que mudou (nulo apaga o dia)', () => {
    const saved = new Map([['2026-11-01', 100], ['2026-11-02', 20]]);
    const edited = new Map<string, number | null>([['2026-11-01', 100], ['2026-11-02', null], ['2026-11-05', 7]]);
    expect(changedEntries(saved, edited)).toEqual([
      { date: '2026-11-02', value: null },
      { date: '2026-11-05', value: 7 },
    ]);
  });
});

function testBed(): HttpTestingController {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { user: signal(ME), status: signal('authenticated') } },
    ],
  });
  return TestBed.inject(HttpTestingController);
}

const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
async function tick(): Promise<void> {
  await drain();
  TestBed.tick();
}

describe('ManualMetricsPage (/dados-manuais)', () => {
  let fixture: ComponentFixture<ManualMetricsPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

  beforeEach(async () => {
    backend = testBed();
    fixture = TestBed.createComponent(ManualMetricsPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    backend.expectOne('/api/manual-metrics').flush({ data: [SALES] });
    await tick();
  });

  afterEach(() => backend.verify());

  it('cria métrica com "último valor" e explica a agregação', async () => {
    expect(el.textContent).toContain('manual:vendas_na_loja');
    button('Nova métrica').click();
    await tick();
    expect(el.textContent).toContain('O período soma os dias lançados');

    const name = el.querySelector<HTMLInputElement>('input[name="manual_name"]')!;
    name.value = 'Clientes ativos';
    name.dispatchEvent(new Event('input'));
    el.querySelector<HTMLInputElement>('input[name="manual_aggregation"][value="last"]')!.dispatchEvent(new Event('change'));
    button('Criar métrica').click();
    await tick();

    const post = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/manual-metrics');
    expect(post.request.body).toEqual({ name: 'Clientes ativos', description: null, unit: 'count', direction: 'higher_is_better', decimals: 0, aggregation: 'last' });
    post.flush({ data: { ...SALES, id: 'mm2' } }, { status: 201, statusText: 'Created' });
    await tick();
    backend.expectOne('/api/manual-metrics').flush({ data: [SALES] });
    await tick();
  });

  it('mostra por que não dá para excluir uma métrica usada por indicador', async () => {
    button('Excluir').click();
    await tick();
    button('Excluir').click();
    await tick();
    backend
      .expectOne((r) => r.method === 'DELETE' && r.url === '/api/manual-metrics/mm1')
      .flush({ message: 'x', errors: { metric: ['Usada pelos indicadores: ROAS real. Ajuste-os antes de excluir.'] } }, { status: 422, statusText: 'Unprocessable' });
    await tick();
    expect(el.querySelector('[data-metric="mm1"] [role="alert"]')?.textContent).toContain('Usada pelos indicadores: ROAS real');
  });
});

describe('ProjectManualValues', () => {
  let fixture: ComponentFixture<ProjectManualValues>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let changes = 0;
  const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

  beforeEach(async () => {
    backend = testBed();
    fixture = TestBed.createComponent(ProjectManualValues);
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.componentRef.setInput('canEdit', true);
    changes = 0;
    fixture.componentInstance.changed.subscribe(() => changes++);
    fixture.componentInstance.month.set('2026-11');
    el = fixture.nativeElement as HTMLElement;
    await tick();
    backend.expectOne('/api/manual-metrics').flush({ data: [SALES] });
    await tick();
    const req = backend.expectOne((r) => r.url === '/api/projects/p1/manual-values');
    expect(req.request.params.get('metric_id')).toBe('mm1');
    expect(req.request.params.get('start')).toBe('2026-11-01');
    expect(req.request.params.get('end')).toBe('2026-11-30');
    req.flush({ data: [{ date: '2026-11-01', value: 1000 }, { date: '2026-11-02', value: 250.5 }] });
    await tick();
  });

  afterEach(() => backend.verify());

  const cell = (day: string) => el.querySelector<HTMLInputElement>(`input[name="manual_${day}"]`)!;
  function type(day: string, value: string): void {
    cell(day).value = value;
    cell(day).dispatchEvent(new Event('input'));
  }

  it('mostra a grade do mês com o total e salva só o que mudou', async () => {
    expect(el.querySelectorAll('.cell')).toHaveLength(30);
    expect(cell('2026-11-02').value).toBe('250,5');
    expect(el.querySelector('.total')?.textContent?.replace(/\u00a0/g, ' ')).toContain('R$ 1.250,50');

    type('2026-11-02', '');
    type('2026-11-03', '1.000,25');
    await tick();
    expect(el.querySelector('.total')?.textContent).toContain('alterações não salvas');
    expect(el.querySelector('.total')?.textContent?.replace(/\u00a0/g, ' ')).toContain('R$ 2.000,25');

    type('2026-11-04', 'abc');
    await tick();
    expect(el.textContent).toContain('Há valores inválidos');
    expect(button('Salvar valores').disabled).toBe(true);
    type('2026-11-04', '');
    await tick();

    button('Salvar valores').click();
    await tick();
    const put = backend.expectOne((r) => r.method === 'PUT' && r.url === '/api/projects/p1/manual-values');
    expect(put.request.body).toEqual({
      metric_id: 'mm1',
      entries: [
        { date: '2026-11-02', value: null },
        { date: '2026-11-03', value: 1000.25 },
      ],
    });
    put.flush({ data: { saved: 1, deleted: 1 } });
    await tick();
    backend.expectOne((r) => r.url === '/api/projects/p1/manual-values').flush({ data: [{ date: '2026-11-01', value: 1000 }, { date: '2026-11-03', value: 1000.25 }] });
    await tick();
    expect(changes).toBe(1);
  });

  it('importa planilha colada e lista os erros por linha', async () => {
    button('Colar planilha').click();
    await tick();
    const area = el.querySelector<HTMLTextAreaElement>('textarea[name="manual_csv"]')!;
    area.value = '01/11/2026;10\n31/02/2026;5';
    area.dispatchEvent(new Event('input'));
    await tick();
    button('Importar').click();
    await tick();

    const post = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/projects/p1/manual-values/import');
    expect(post.request.body).toEqual({ metric_id: 'mm1', csv: '01/11/2026;10\n31/02/2026;5' });
    post.flush({ data: { saved: 1, deleted: 0, errors: [{ line: 2, message: 'Data inválida: "31/02/2026".' }] } });
    await tick();
    backend.expectOne((r) => r.url === '/api/projects/p1/manual-values').flush({ data: [] });
    await tick();

    expect(el.textContent).toContain('1 valor gravado');
    expect(el.textContent).toContain('Linha 2: Data inválida');
    expect(changes).toBe(1);
  });
});
