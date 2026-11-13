import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Me, Post, Role } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { PublishingPage } from './publishing.page';
import { calendarRange, dayKey, shiftAnchor } from './publishing';
import { makePost } from './publishing-fixtures';

const me = (role: Role): Me => ({
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

/** Hoje às 15h (fuso do navegador), para cair na célula de hoje. */
function todayAt(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

describe('PublishingPage', () => {
  let fixture: ComponentFixture<PublishingPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
    TestBed.tick();
  }
  const button = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
  const postsReq = (): TestRequest => backend.expectOne((r) => r.url === '/api/posts' && r.params.has('from'));
  const pendingReq = (): TestRequest => backend.expectOne((r) => r.url === '/api/posts' && r.params.has('status'));

  async function mount(role: Role = 'owner', posts: Post[] = [], pending: Post[] = []): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PublishingPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    const req = postsReq();
    const range = calendarRange('month', new Date());
    expect(req.request.params.get('from')).toBe(range.from);
    expect(req.request.params.get('to')).toBe(range.to);
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    req.flush({ data: posts });
    const p = pendingReq();
    expect(p.request.params.get('status')).toBe('in_review,scheduled,failed');
    p.flush({ data: pending });
    backend.expectOne('/api/projects').flush({ data: [{ id: 'p1', name: 'Padaria Aurora', niche: null, created_at: '' }, { id: 'p2', name: 'Curso Alfa', niche: null, created_at: '' }] });
    await tick();
  }

  afterEach(() => backend.verify());

  it('calendário do mês com o post no dia, ícones das redes e contadores', async () => {
    const soon = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    await mount(
      'owner',
      [makePost({ status: 'scheduled', scheduled_at: todayAt(15) })],
      [makePost({ id: 'r', status: 'in_review' }), makePost({ id: 's', status: 'scheduled', scheduled_at: soon }), makePost({ id: 'f', status: 'failed' })],
    );
    const today = el.querySelector<HTMLElement>(`[data-day="${dayKey(new Date())}"]`)!;
    const chip = today.querySelector<HTMLAnchorElement>('a.chip')!;
    expect(chip.getAttribute('href')).toBe('/publicacoes/post1');
    expect(chip.getAttribute('data-tone')).toBe('accent');
    expect(chip.textContent).toContain('Pão de fermentação natural');
    expect(chip.querySelector('app-provider-icon')).not.toBeNull();
    expect(today.classList.contains('today')).toBe(true);

    const counters = [...el.querySelectorAll('[data-testid="counters"] .counter')].map((c) => [c.querySelector('strong')?.textContent, c.querySelector('span')?.textContent]);
    expect(counters).toEqual([
      ['1', 'aguardando aprovação'],
      ['1', 'agendados nos próximos 7 dias'],
      ['1', 'com falha'],
    ]);
    expect(el.querySelector('a[href="/publicacoes/novo"]')?.textContent).toContain('Novo post');
  });

  it('filtra por status no navegador e por projeto no servidor; navega entre meses', async () => {
    await mount('owner', [makePost({ id: 'a', status: 'draft', created_at: todayAt(9) }), makePost({ id: 'b', status: 'failed', scheduled_at: todayAt(10) })]);
    const status = el.querySelector<HTMLSelectElement>('[data-testid="status-filter"]')!;
    status.value = 'failed';
    status.dispatchEvent(new Event('change'));
    await tick();
    expect([...el.querySelectorAll('a.chip')].map((a) => a.getAttribute('data-post'))).toEqual(['b']);

    const project = el.querySelector<HTMLSelectElement>('[data-testid="project-filter"]')!;
    project.value = 'p2';
    project.dispatchEvent(new Event('change'));
    await tick();
    expect(postsReq().request.params.get('project_id')).toBe('p2');
    expect(pendingReq().request.params.get('project_id')).toBe('p2');
    backend.match((r) => r.url === '/api/posts').forEach((r) => r.flush({ data: [] }));

    el.querySelector<HTMLButtonElement>('[aria-label="Próximo mês"]')!.click();
    await tick();
    const next = calendarRange('month', shiftAnchor('month', new Date(), 1));
    const req = postsReq();
    expect(req.request.params.get('from')).toBe(next.from);
    req.flush({ data: [] });
    await tick();
    expect(el.querySelector('[data-testid="calendar-empty"]')?.textContent).toContain('com este status');
  });

  it('lista agrupada por dia e "+N" no mês abre a semana', async () => {
    const posts = Array.from({ length: 4 }, (_, i) => makePost({ id: `p${i}`, title: `Post ${i}`, status: 'scheduled', scheduled_at: todayAt(10 + i) }));
    await mount('owner', posts);
    const more = button('+1')!;
    expect(more).toBeDefined();
    more.click();
    await tick();
    const req = postsReq();
    expect(req.request.params.get('from')).toBe(calendarRange('week', new Date()).from);
    req.flush({ data: posts });
    await tick();
    expect(el.querySelector('[data-testid="calendar"]')?.getAttribute('data-view')).toBe('week');
    expect(el.querySelectorAll('a.chip').length).toBe(4);

    button('Lista')!.click();
    await tick();
    backend.match((r) => r.url === '/api/posts' && r.params.has('from')).forEach((r) => r.flush({ data: posts }));
    await tick();
    const list = el.querySelector('[data-testid="list"]')!;
    expect(list.querySelectorAll('a.item').length).toBe(4);
    expect(list.textContent).toContain('Instagram Feed');
    expect(list.textContent).toContain('Agendado');
  });

  it('cliente: sem "Novo post" e sem a aba Mídia', async () => {
    await mount('client');
    expect(el.querySelector('a[href="/publicacoes/novo"]')).toBeNull();
    expect(button('Mídia')).toBeUndefined();
    expect(el.textContent).toContain('Os posts preparados pela agência');
  });

  it('aba Mídia mostra a biblioteca (equipe)', async () => {
    await mount('analyst');
    button('Mídia')!.click();
    await tick();
    backend.expectOne((r) => r.url === '/api/media').flush({ data: [] });
    await tick();
    expect(el.querySelector('app-media-library [data-testid="drop-zone"]')).not.toBeNull();
  });
});
