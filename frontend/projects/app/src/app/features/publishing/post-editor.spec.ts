import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { Me, Post, Role } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { PostEditorPage } from './post-editor.page';
import { fromLocalInput } from './publishing';
import { NETWORKS, makePost } from './publishing-fixtures';

const me = (role: Role): Me => ({
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const LINK = 'http://localhost:4300/aprovar/' + 'k'.repeat(48);

describe('PostEditorPage', () => {
  let fixture: ComponentFixture<PostEditorPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let toast: DsToastService;
  let navigate: ReturnType<typeof vi.spyOn>;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
    TestBed.tick();
  }
  const button = (text: string, root: ParentNode = el) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
  const type = (selector: string, value: string) => {
    const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
  };

  function setup(role: Role): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(DsToastService);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(PostEditorPage);
    el = fixture.nativeElement as HTMLElement;
  }

  /** Post existente: GET do post e das redes do projeto. */
  async function open(post: Post, role: Role = 'owner'): Promise<void> {
    setup(role);
    fixture.componentRef.setInput('id', post.id);
    await tick();
    backend.expectOne('/api/posts/post1').flush({ data: post });
    await tick();
    const networks = backend.expectOne((r) => r.url === '/api/publishing/networks');
    expect(networks.request.params.get('project_id')).toBe('p1');
    networks.flush({ data: NETWORKS });
    await tick();
  }

  afterEach(() => backend.verify());

  it('novo post: projeto do link, rede com a conta única já escolhida, contador e criação', async () => {
    setup('analyst');
    fixture.componentRef.setInput('projeto', 'p1');
    await tick();
    backend.expectOne('/api/projects').flush({ data: [{ id: 'p1', name: 'Padaria Aurora', niche: null, created_at: '' }] });
    backend.expectOne((r) => r.url === '/api/publishing/networks').flush({ data: NETWORKS });
    await tick();

    expect(el.querySelector('h1')?.textContent).toContain('Novo post');
    expect(el.querySelector<HTMLSelectElement>('[data-testid="project-select"]')?.value).toBe('p1');
    button('Adicionar rede')!.click();
    await tick();
    const target = el.querySelector<HTMLElement>('[data-target="0"]')!;
    expect(target.querySelector<HTMLSelectElement>('[aria-label="Rede do destino 1"]')?.value).toBe('instagram');
    expect(target.querySelector<HTMLSelectElement>('[aria-label="Conta do destino 1"]')?.value).toBe('a1');
    expect(target.querySelector('[data-testid="sandbox-note"]')?.textContent).toContain('demonstração');

    type('input[name="title"]', 'Pão de fermentação natural');
    type('textarea[name="caption"]', 'Fornada nova! #padaria #pão');
    await tick();
    const counter = el.querySelector('[data-testid="caption-counter"]')!.textContent!.replace(/\s+/g, ' ');
    expect(counter).toContain('27 / 2200 caracteres (limite do Instagram)');
    expect(counter).toContain('2 / 30 hashtags');
    expect(el.querySelector('[data-testid="preview"], app-post-preview')).not.toBeNull();

    button('Criar post')!.click();
    await tick();
    const req = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/posts');
    expect(req.request.body).toEqual({
      project_id: 'p1',
      title: 'Pão de fermentação natural',
      caption: 'Fornada nova! #padaria #pão',
      media: [],
      requires_approval: true,
      targets: [{ network: 'instagram', format: 'feed', account_id: 'a1' }],
    });
    req.flush({ data: makePost({ problems: ['Instagram (Feed): use exatamente 1 imagem ou vídeo.'], media: [] }) }, { status: 201, statusText: 'Created' });
    await tick();
    expect(navigate).toHaveBeenCalledWith(['/publicacoes', 'post1'], { replaceUrl: true });
  });

  it('mostra as pendências, o status e pede a aprovação com o link e os avisos', async () => {
    await open(makePost({ problems: ['Escolha ao menos uma rede.'] }));
    expect(el.querySelector('[data-testid="post-status"]')?.textContent).toBe('Rascunho');
    expect(el.querySelector('[data-testid="problems"]')?.textContent).toContain('Escolha ao menos uma rede.');
    expect(button('Agendar')).toBeUndefined(); // exige aprovação antes
    expect(button('Publicar agora')).toBeUndefined();

    button('Pedir aprovação')!.click();
    await tick();
    const req = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/posts/post1/approval');
    expect(req.request.body).toEqual({ notify: true });
    const approval = { link: LINK, active: true, expires_at: '2026-11-26T10:00:00Z', decided_at: null, decision: null, comment: null, decided_by_name: null, notified: { email: 1, whatsapp: 0 } };
    req.flush({ data: makePost({ status: 'in_review', approval }), meta: { link: LINK, notified: { email: 1, whatsapp: 0 } } });
    await tick();

    const panel = el.querySelector('[data-testid="approval"]')!;
    expect(panel.querySelector<HTMLInputElement>('#approval-link')?.value).toBe(LINK);
    expect(panel.querySelector('[data-testid="notified"]')?.textContent).toContain('Avisos enviados: 1 por e-mail.');
    expect(panel.textContent).toContain('últimas 24 horas');
    expect(el.querySelector('[data-testid="post-status"]')?.textContent).toBe('Aguardando aprovação');
    expect(el.textContent).toContain('agendado sozinho quando o cliente aprovar');
  });

  it('em revisão: guarda a data no fuso do navegador', async () => {
    await open(makePost({ status: 'in_review' }));
    const successSpy = vi.spyOn(toast, 'success');
    const input = el.querySelector<HTMLInputElement>('input[name="scheduled_at"]')!;
    input.value = '2099-12-01T14:30';
    input.dispatchEvent(new Event('input'));
    button('Agendar')!.click();
    await tick();
    const req = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/posts/post1/schedule');
    expect(req.request.body).toEqual({ scheduled_at: fromLocalInput('2099-12-01T14:30') });
    req.flush({ data: makePost({ status: 'in_review', scheduled_at: fromLocalInput('2099-12-01T14:30') }) });
    await tick();
    expect(successSpy).toHaveBeenCalledWith('Data guardada', { message: 'Ele é agendado sozinho quando o cliente aprovar.' });
  });

  it('avisa quando a edição invalidou a aprovação', async () => {
    await open(makePost({ status: 'approved' }));
    type('textarea[name="caption"]', 'Legenda nova');
    await tick();
    expect(button('Publicar agora')?.disabled).toBe(true); // salvar antes
    button('Salvar alterações')!.click();
    await tick();
    const req = backend.expectOne((r) => r.method === 'PATCH' && r.url === '/api/posts/post1');
    expect(req.request.body.caption).toBe('Legenda nova');
    expect(req.request.body).not.toHaveProperty('project_id');
    req.flush({ data: makePost({ status: 'draft', caption: 'Legenda nova' }), meta: { approval_reset: true } });
    await tick();
    expect(el.querySelector('[data-testid="approval-reset"]')?.textContent).toContain('voltou a rascunho');
    expect(el.querySelector('[data-testid="post-status"]')?.textContent).toBe('Rascunho');
  });

  it('mostra as pendências que o servidor devolveu numa ação', async () => {
    await open(makePost({ status: 'approved' }));
    button('Publicar agora')!.click();
    await tick();
    button('Publicar')!.click();
    await tick();
    backend
      .expectOne((r) => r.method === 'POST' && r.url === '/api/posts/post1/publish')
      .flush({ message: 'x', errors: { post: ['Instagram (Feed): escolha a conta.', 'Escolha ao menos uma rede.'] } }, { status: 422, statusText: 'x' });
    await tick();
    const problems = el.querySelector('[data-testid="problems"]')!.textContent!;
    expect(problems).toContain('Instagram (Feed): escolha a conta.');
    expect(problems).toContain('Escolha ao menos uma rede.');
  });

  it('publica agora e mostra o resultado de cada rede', async () => {
    await open(makePost({ status: 'approved' }));
    button('Publicar agora')!.click();
    await tick();
    button('Publicar')!.click();
    await tick();
    backend.expectOne((r) => r.method === 'POST' && r.url === '/api/posts/post1/publish').flush(
      {
        data: makePost({
          status: 'failed',
          targets: [{ ...makePost().targets[0], status: 'failed', error: 'A conta não deu ao Delta a permissão necessária.' }],
        }),
      },
      { status: 202, statusText: 'Accepted' },
    );
    await tick();
    expect(el.querySelector('[data-testid="post-status"]')?.textContent).toBe('Falhou');
    const target = el.querySelector('[data-target="0"]')!;
    expect(target.querySelector('.pill')?.textContent).toBe('Falhou');
    expect(target.textContent).toContain('permissão necessária');
  });

  it('cliente só lê: sem ações, sem edição e sem link de aprovação', async () => {
    await open(makePost({ status: 'in_review' }), 'client');
    expect(el.querySelector('[data-testid="actions"]')).toBeNull();
    expect(el.querySelector<HTMLTextAreaElement>('textarea[name="caption"]')?.readOnly).toBe(true);
    expect(button('Adicionar rede')).toBeUndefined();
    expect(el.querySelector('[data-testid="approval"]')).toBeNull();
    expect(el.querySelector('[data-target="0"]')?.textContent).toContain('Instagram · Feed');
  });

  it('post não encontrado', async () => {
    setup('owner');
    fixture.componentRef.setInput('id', 'post1');
    await tick();
    backend.expectOne('/api/posts/post1').flush({ message: 'x' }, { status: 404, statusText: 'x' });
    await tick();
    expect(el.textContent).toContain('Post não encontrado');
  });
});
