import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AiReply, AiStatus, Me, ReportLayout, Role } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { REPORT_LIMITS } from '../../core/reports/report-layout';
import {
  ANALYSIS_TITLE,
  aiErrorMessage,
  aiReady,
  aiSettingsBody,
  aiUsage,
  insertAnalysis,
  parseTokens,
  validateAiSettings,
} from './ai';
import { ProjectCopilot } from './project-copilot';

const STATUS: AiStatus = { enabled: true, configured: true, source: 'agency', budget: 2_000_000, used_this_month: 150_000 };

const REPLY: AiReply = {
  text: 'O CPA subiu 18% porque o CTR caiu.',
  verified: true,
  unverified_numbers: [],
  model: 'claude-opus-5-5',
  suggestion: true,
};

const http422 = (body: unknown) => new HttpErrorResponse({ status: 422, error: body });

describe('helpers do copiloto', () => {
  it('só está pronto ligado e com chave', () => {
    expect(aiReady(STATUS)).toBe(true);
    expect(aiReady({ ...STATUS, configured: false })).toBe(false);
    expect(aiReady({ ...STATUS, enabled: false })).toBe(false);
    expect(aiReady(null)).toBe(false);
  });

  it('traduz os erros do copiloto', () => {
    expect(aiErrorMessage(http422({ message: 'x', errors: { ai: ['O orçamento acabou.'] } }))).toBe('O orçamento acabou.');
    expect(aiErrorMessage(http422({ message: 'x', errors: { question: ['Escreva a pergunta.'] } }))).toBe('Escreva a pergunta.');
    expect(aiErrorMessage(new HttpErrorResponse({ status: 429 }))).toContain('Espere um minuto');
    expect(aiErrorMessage(new HttpErrorResponse({ status: 500 }))).toContain('Não foi possível falar com o copiloto');
  });

  it('calcula o uso do mês e o tom da barra', () => {
    expect(aiUsage(STATUS)).toEqual({ pct: 8, tone: 'ok' });
    expect(aiUsage({ budget: 100, used_this_month: 85 })).toEqual({ pct: 85, tone: 'warn' });
    expect(aiUsage({ budget: 100, used_this_month: 130 })).toEqual({ pct: 100, tone: 'over' });
  });

  it('valida o orçamento e a chave; a chave só vai quando é trocada', () => {
    expect(parseTokens('2.000.000')).toBe(2_000_000);
    expect(Number.isNaN(parseTokens('dois'))).toBe(true);
    expect(validateAiSettings({ api_key: '', enabled: true, budget: '2.000.000' })).toEqual({});
    expect(validateAiSettings({ api_key: 'curta', enabled: true, budget: '500' })).toEqual({
      api_key: expect.stringContaining('incompleta'),
      monthly_token_budget: expect.stringContaining('Use entre 10.000 e 500.000.000'),
    });
    expect(validateAiSettings({ api_key: 'sk-ant com espaço e mais texto', enabled: true, budget: 'abc' })).toEqual({
      api_key: expect.stringContaining('espaços'),
      monthly_token_budget: expect.stringContaining('só números'),
    });
    expect(aiSettingsBody({ api_key: '  ', enabled: false, budget: '1.000.000' })).toEqual({ enabled: false, monthly_token_budget: 1_000_000 });
    expect(aiSettingsBody({ api_key: ' sk-ant-123 ', enabled: true, budget: '20000' })).toEqual({
      api_key: 'sk-ant-123',
      enabled: true,
      monthly_token_budget: 20_000,
    });
  });

  describe('insertAnalysis', () => {
    const layout: ReportLayout = {
      sections: [
        {
          id: 's1',
          title: 'Resumo do período',
          blocks: [
            { id: 'b0', type: 'text', title: 'Observações', content: 'outro texto' },
            { id: 'b1', type: 'kpis', metrics: ['meta_ads:spend'] },
          ],
        },
        { id: 's2', title: 'Meta Ads', blocks: [{ id: 'b2', type: 'text', title: 'Análise da agência', content: 'Escreva aqui…' }] },
      ],
    };

    it('substitui o texto do bloco de análise (sem acento ou caixa importarem)', () => {
      const result = insertAnalysis(layout, '  Texto novo  ')!;
      expect(result.replaced).toBe(true);
      expect(result.blockId).toBe('b2');
      expect(result.layout.sections[1].blocks[0]).toEqual({ id: 'b2', type: 'text', title: 'Análise da agência', content: 'Texto novo' });
      expect(result.layout.sections[0]).toEqual(layout.sections[0]);

      const lower = insertAnalysis({ sections: [{ id: 's', title: 'x', blocks: [{ id: 'bx', type: 'text', title: 'ANALISE', content: '' }] }] }, 'ok')!;
      expect(lower.blockId).toBe('bx');
    });

    it('sem bloco de análise, cria um no topo da primeira seção', () => {
      const result = insertAnalysis({ sections: [layout.sections[0]] }, 'Texto', () => 'b_new')!;
      expect(result.replaced).toBe(false);
      expect(result.layout.sections[0].blocks.map((b) => b.id)).toEqual(['b_new', 'b0', 'b1']);
      expect(result.layout.sections[0].blocks[0]).toEqual({ id: 'b_new', type: 'text', title: ANALYSIS_TITLE, content: 'Texto' });
    });

    it('relatório vazio ganha uma seção; corta no limite de texto; devolve null sem espaço', () => {
      const empty = insertAnalysis({ sections: [] }, 'x'.repeat(REPORT_LIMITS.text + 50), () => 'b_new')!;
      expect(empty.layout.sections).toHaveLength(1);
      expect(empty.layout.sections[0].title).toBe('Resumo do período');
      expect(empty.layout.sections[0].blocks[0].type === 'text' && empty.layout.sections[0].blocks[0].content.length).toBe(REPORT_LIMITS.text);

      const fullBlocks = Array.from({ length: REPORT_LIMITS.blocks }, (_, i) => ({ id: `k${i}`, type: 'kpis' as const, metrics: ['m:x'] }));
      const fullSections = Array.from({ length: REPORT_LIMITS.sections }, (_, i) => ({ id: `s${i}`, title: 'S', blocks: fullBlocks }));
      expect(insertAnalysis({ sections: fullSections }, 'x')).toBeNull();
    });
  });
});

describe('ProjectCopilot', () => {
  let fixture: ComponentFixture<ProjectCopilot>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
  }
  const me = (role: Role): Me => ({
    id: 'u1',
    name: 'Ana Lima',
    email: 'ana@agencia.com',
    two_factor_enabled: false,
    tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
  });
  const textarea = () => el.querySelector<HTMLTextAreaElement>('textarea[name="question"]')!;
  const type = (value: string) => {
    textarea().value = value;
    textarea().dispatchEvent(new Event('input'));
  };
  const submit = () => el.querySelector('form')!.dispatchEvent(new Event('submit'));

  async function mount(status: AiStatus, role: Role = 'owner'): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectCopilot);
    fixture.componentRef.setInput('projectId', 'p1');
    el = fixture.nativeElement as HTMLElement;
    await tick();
    const req = backend.expectOne('/api/ai');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    req.flush({ data: status });
    await tick();
  }

  afterEach(() => backend.verify());

  it('pergunta, mostra a resposta e guarda o histórico da visita', async () => {
    await mount(STATUS);
    expect(el.querySelectorAll('.examples .chip')).toHaveLength(3);

    (el.querySelector<HTMLButtonElement>('.examples .chip'))!.click();
    await tick();
    expect(textarea().value).toBe('O que mais mudou nos últimos 30 dias?');

    type('Por que o CPA subiu?');
    submit();
    await tick();
    const req = backend.expectOne('/api/projects/p1/ai/ask');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ question: 'Por que o CPA subiu?' });
    expect(el.querySelector('[aria-busy="true"]')?.textContent).toContain('Analisando');
    expect(textarea().value).toBe('');
    req.flush({ data: REPLY });
    await tick();

    expect(el.querySelector('.question')?.textContent).toContain('Por que o CPA subiu?');
    expect(el.querySelector('[data-testid="ai-text"]')?.textContent).toContain('O CPA subiu 18%');
    expect(el.querySelector('.unverified')).toBeNull();

    type('E o ROAS?');
    submit();
    await tick();
    backend.expectOne('/api/projects/p1/ai/ask').flush({
      data: { ...REPLY, text: 'ROAS de 9,9.', verified: false, unverified_numbers: ['9,9'] },
    });
    await tick();
    expect(el.querySelectorAll('.turn')).toHaveLength(2);
    expect(el.querySelectorAll('.turn')[1].querySelector('.unverified')?.textContent).toContain('9,9');
  });

  it('valida o tamanho da pergunta sem chamar a API e mostra o erro do copiloto', async () => {
    await mount(STATUS);

    type('oi');
    submit();
    await tick();
    backend.expectNone('/api/projects/p1/ai/ask');
    expect(el.querySelector('#copilot-error')?.textContent).toContain('pelo menos 3 letras');

    type('Como está o mês?');
    submit();
    await tick();
    backend.expectOne('/api/projects/p1/ai/ask').flush(
      { message: 'x', errors: { ai: ['O copiloto de IA não está configurado.'] } },
      { status: 422, statusText: 'Unprocessable Content' },
    );
    await tick();
    expect(el.querySelector('.turn .error')?.textContent).toContain('não está configurado');
  });

  it('sem chave: estado vazio com o atalho só para dono/admin', async () => {
    await mount({ ...STATUS, configured: false, source: null });
    expect(el.querySelector('[data-testid="copilot-empty"]')?.textContent).toContain('ainda não tem uma chave');
    expect(el.querySelector('[data-testid="copilot-empty"] a')?.getAttribute('href')).toBe('/configuracoes/ia');
    expect(el.querySelector('form')).toBeNull();
  });

  it('analista vê o pedido para falar com um administrador; desligado também explica', async () => {
    await mount({ ...STATUS, enabled: false }, 'analyst');
    const empty = el.querySelector('[data-testid="copilot-empty"]');
    expect(empty?.textContent).toContain('está desligado');
    expect(empty?.textContent).toContain('Peça a um dono ou administrador');
    expect(empty?.querySelector('a')).toBeNull();
  });
});
