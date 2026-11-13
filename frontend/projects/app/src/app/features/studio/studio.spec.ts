import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Me, Presentation, Role } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { REPORT_DATA } from '../reports/report-fixtures';
import { PresentationPage } from './presentation.page';
import { aiError, clampSlide, createBody, emptyDraft, slideCount, slideData, validateDraft } from './studio';
import { StudioPage } from './studio.page';

const me = (role: Role): Me => ({
  id: 'u1',
  name: 'Ana',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const PRESENTATION: Presentation = {
  id: 'pr1',
  title: 'Resultados de outubro',
  format: 'slides',
  status: 'ready',
  error: null,
  project: { id: 'p1', name: 'Padaria Aurora' },
  current_version: 2,
  period_preset: 'last_30',
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:05:00Z',
  brief: 'Apresentação mensal para o dono da padaria.',
  period_start: null,
  period_end: null,
  compare: 'previous_period',
  version: { number: 2, instruction: 'Mais curto', rendered: REPORT_DATA, unverified_numbers: [], created_at: '2026-11-12T10:05:00Z' },
  versions: [
    { number: 1, instruction: 'Apresentação mensal para o dono da padaria.', created_at: '2026-11-12T10:00:00Z', verified: true },
    { number: 2, instruction: 'Mais curto', created_at: '2026-11-12T10:05:00Z', verified: true },
  ],
};

const drain = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('helpers do Studio', () => {
  it('valida o pedido e monta o corpo do POST', () => {
    expect(validateDraft(emptyDraft())).toEqual({ project_id: 'Escolha o projeto.', brief: 'Descreva um pouco mais (pelo menos 10 caracteres).' });
    const custom = { ...emptyDraft('p1'), brief: 'Resultados do mês para o cliente', period_preset: 'custom' as const, period_start: '2026-10-10', period_end: '2026-10-01' };
    expect(validateDraft(custom)).toEqual({ period_end: 'O fim vem depois do início.' });
    expect(createBody({ ...emptyDraft('p1'), brief: '  Resultados do mês  ', title: ' ' })).toEqual({
      project_id: 'p1', brief: 'Resultados do mês', title: null, format: 'slides', period_preset: 'last_30', period_start: null, period_end: null, compare: 'previous_period',
    });
  });

  it('cada seção vira um slide, depois da capa', () => {
    expect(slideCount(REPORT_DATA)).toBe(3);
    expect(slideData(REPORT_DATA, 0).sections).toEqual([]);
    expect(slideData(REPORT_DATA, 2).sections.map((s) => s.title)).toEqual(['Meta Ads']);
    expect([clampSlide(-1, 3), clampSlide(5, 3), clampSlide(1, 0)]).toEqual([0, 2, 0]);
    const err = new HttpErrorResponse({ status: 422, error: { errors: { ai: ['O copiloto de IA não está configurado.'] } } });
    expect(aiError(err)).toBe('O copiloto de IA não está configurado.');
  });
});

describe('StudioPage', () => {
  let fixture: ComponentFixture<StudioPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  const tick = async () => {
    await drain();
    TestBed.tick();
    await drain();
    TestBed.tick();
  };
  const button = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().endsWith(text));

  async function mount(role: Role = 'owner', list: unknown[] = []): Promise<void> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } }],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StudioPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    if (role !== 'client') {
      backend.expectOne('/api/presentations').flush({ data: list });
      await tick();
    }
  }

  afterEach(() => backend.verify());

  it('explica o Studio e cria a apresentação, abrindo a tela dela', async () => {
    await mount();
    expect(el.textContent).toContain('os números são calculados pelo Delta');
    expect(el.querySelector('[data-testid="studio-empty"]')).not.toBeNull();

    button('Nova apresentação')!.click();
    await tick();
    backend.expectOne('/api/projects').flush({ data: [{ id: 'p1', name: 'Padaria Aurora', niche: null, created_at: '' }] });
    await tick();

    button('Gerar apresentação')!.click();
    await tick();
    expect(el.textContent).toContain('Escolha o projeto.');

    const select = el.querySelector<HTMLSelectElement>('select[name="project_id"]')!;
    select.value = 'p1';
    select.dispatchEvent(new Event('change'));
    const brief = el.querySelector<HTMLTextAreaElement>('textarea[name="brief"]')!;
    brief.value = 'Resultados do mês para a reunião com o cliente';
    brief.dispatchEvent(new Event('input'));
    el.querySelector<HTMLInputElement>('input[name="format"][value="page"]')!.click();
    await tick();

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    button('Gerar apresentação')!.click();
    await tick();
    const req = backend.expectOne('/api/presentations');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({ project_id: 'p1', brief: 'Resultados do mês para a reunião com o cliente', format: 'page', period_preset: 'last_30' });
    req.flush({ data: { ...PRESENTATION, id: 'novo', status: 'generating', version: null, versions: [], current_version: 0 } }, { status: 202, statusText: 'Accepted' });
    await tick();
    expect(navigate).toHaveBeenCalledWith(['/studio', 'novo']);
  });

  it('mostra quando a IA não está configurada, com link para o admin', async () => {
    await mount('owner', [{ id: 'pr1', title: 'Resultados', format: 'slides', status: 'ready', error: null, project: { id: 'p1', name: 'Padaria' }, current_version: 1, period_preset: 'last_30', created_at: '', updated_at: '2026-11-12T10:00:00Z' }]);
    expect(el.querySelector('[data-id="pr1"]')?.getAttribute('href')).toBe('/studio/pr1');
    expect(el.querySelector('[data-id="pr1"]')?.textContent).toContain('Pronta');

    button('Nova apresentação')!.click();
    await tick();
    backend.expectOne('/api/projects').flush({ data: [{ id: 'p1', name: 'Padaria', niche: null, created_at: '' }] });
    await tick();
    const select = el.querySelector<HTMLSelectElement>('select[name="project_id"]')!;
    select.value = 'p1';
    select.dispatchEvent(new Event('change'));
    const brief = el.querySelector<HTMLTextAreaElement>('textarea[name="brief"]')!;
    brief.value = 'Resultados do mês para o cliente';
    brief.dispatchEvent(new Event('input'));
    await tick();
    button('Gerar apresentação')!.click();
    await tick();
    backend.expectOne('/api/presentations').flush({ message: 'x', errors: { ai: ['O Studio usa a IA da agência, que não está configurada.'] } }, { status: 422, statusText: 'Unprocessable' });
    await tick();
    const error = el.querySelector('[data-testid="studio-ai-error"]');
    expect(error?.textContent).toContain('não está configurada');
    expect(error?.querySelector('a')?.getAttribute('href')).toBe('/configuracoes/ia');
  });

  it('cliente não vê o Studio', async () => {
    await mount('client');
    backend.expectNone('/api/presentations');
    expect(el.textContent).toContain('O Studio é da equipe da agência.');
  });
});

describe('PresentationPage', () => {
  let fixture: ComponentFixture<PresentationPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  const tick = async () => {
    await drain();
    TestBed.tick();
    await drain();
    TestBed.tick();
  };
  const button = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().endsWith(text));
  const counter = () => el.querySelector('[data-testid="slide-counter"]')?.textContent?.trim();

  async function mount(p: Presentation = PRESENTATION): Promise<void> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { user: signal(me('analyst')), status: signal('authenticated') } }],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PresentationPage);
    fixture.componentRef.setInput('id', p.id);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    backend.expectOne(`/api/presentations/${p.id}`).flush({ data: p });
    await tick();
  }

  afterEach(() => backend.verify());

  it('mostra os slides (capa + uma seção por slide) e navega pelas setas do teclado', async () => {
    await mount();
    expect(el.textContent).toContain('A IA escolhe as métricas e escreve a narrativa');
    expect(counter()).toBe('1 / 3');
    expect(el.querySelector('.cover')?.textContent).toContain('Relatório de outubro');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await tick();
    expect(counter()).toBe('2 / 3');
    expect(el.querySelector('.cover')).toBeNull();
    expect(el.querySelector('.section-title')?.textContent).toContain('Resumo do período');

    el.querySelector<HTMLButtonElement>('[aria-label="Próximo slide"]')!.click();
    await tick();
    expect(counter()).toBe('3 / 3');
    expect(el.querySelector<HTMLButtonElement>('[aria-label="Próximo slide"]')!.disabled).toBe(true);

    // Digitando no chat, as setas não trocam de slide.
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea[name="instruction"]')!;
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await tick();
    expect(counter()).toBe('3 / 3');
  });

  it('avisa números não conferidos e mostra a geração em andamento', async () => {
    await mount({ ...PRESENTATION, format: 'page', version: { ...PRESENTATION.version!, unverified_numbers: ['9,87', 'R$ 12,00'] } });
    expect(el.querySelector('[data-testid="studio-unverified"]')?.textContent).toContain('9,87, R$ 12,00');
    expect(el.querySelector('[data-testid="slide-counter"]')).toBeNull(); // página contínua
    expect(el.querySelectorAll('.section-title').length).toBe(2);
  });

  it('pede ajuste por chat, mostra que está gerando e volta para uma versão anterior', async () => {
    await mount();
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea[name="instruction"]')!;
    textarea.value = 'Deixe só um slide de resumo';
    textarea.dispatchEvent(new Event('input'));
    await tick();
    button('Ajustar')!.click();
    await tick();
    const req = backend.expectOne('/api/presentations/pr1/revise');
    expect(req.request.body).toEqual({ instruction: 'Deixe só um slide de resumo' });
    req.flush({ data: { ...PRESENTATION, status: 'generating' } }, { status: 202, statusText: 'Accepted' });
    await tick();
    expect(el.querySelector('[data-testid="studio-revising"]')?.textContent).toContain('Gerando uma nova versão');
    expect(textarea.disabled).toBe(true);

    const versions = el.querySelector('[data-testid="studio-versions"]')!;
    expect(versions.textContent).toContain('Versão 2');
    expect(versions.textContent).toContain('atual');
    [...versions.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Voltar para esta')!.click();
    await tick();
    const restore = backend.expectOne('/api/presentations/pr1/restore');
    expect(restore.request.body).toEqual({ number: 1 });
    restore.flush({ data: { ...PRESENTATION, current_version: 1 } });
    await tick();
    expect(el.textContent).toContain('versão 1');
  });

  it('em erro, oferece tentar de novo', async () => {
    await mount({ ...PRESENTATION, status: 'error', error: 'A IA não conseguiu montar a apresentação agora.', version: null, versions: [], current_version: 0 });
    expect(el.querySelector('[data-testid="studio-error"]')?.textContent).toContain('não conseguiu montar');
    button('Tentar de novo')!.click();
    await tick();
    backend.expectOne('/api/presentations/pr1/retry').flush({ data: { ...PRESENTATION, status: 'generating', version: null, versions: [], current_version: 0 } }, { status: 202, statusText: 'Accepted' });
    await tick();
    expect(el.querySelector('[data-testid="studio-generating"]')?.textContent).toContain('Gerando a apresentação');
  });
});
