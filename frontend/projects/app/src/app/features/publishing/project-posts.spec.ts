import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Me, Role } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { ProjectPosts } from './project-posts';
import { dayKey } from './publishing';
import { makePost } from './publishing-fixtures';

const me = (role: Role): Me => ({
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

describe('ProjectPosts', () => {
  let backend: HttpTestingController;
  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));

  async function render(role: Role, posts = [makePost()]): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ProjectPosts);
    fixture.componentRef.setInput('projectId', 'p1');
    await drain();
    TestBed.tick();
    const req = backend.expectOne((r) => r.url === '/api/posts');
    expect(req.request.params.get('project_id')).toBe('p1');
    expect(req.request.params.get('from')).toBe(dayKey(new Date()));
    req.flush({ data: posts });
    await drain();
    TestBed.tick();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => backend.verify());

  it('mostra as próximas 5, na ordem, sem as canceladas, com links para o calendário', async () => {
    const posts = [
      makePost({ id: 'late', title: 'Depois', status: 'scheduled', scheduled_at: '2026-12-20T12:00:00Z' }),
      makePost({ id: 'x', title: 'Cancelado', status: 'cancelled', scheduled_at: '2026-12-01T12:00:00Z' }),
      makePost({ id: 'soon', title: 'Antes', status: 'in_review', scheduled_at: '2026-12-02T12:00:00Z' }),
      ...Array.from({ length: 5 }, (_, i) => makePost({ id: `f${i}`, status: 'scheduled', scheduled_at: `2026-12-2${i + 1}T12:00:00Z` })),
    ];
    const el = await render('owner', posts);
    const items = [...el.querySelectorAll('[data-post]')].map((a) => a.getAttribute('data-post'));
    expect(items).toEqual(['soon', 'late', 'f0', 'f1', 'f2']);
    expect(el.querySelector('[data-post="soon"]')?.textContent).toContain('Aguardando aprovação');
    expect(el.querySelector('a.all')?.getAttribute('href')).toBe('/publicacoes?projeto=p1');
    expect(el.querySelector('a.new')?.getAttribute('href')).toBe('/publicacoes/novo?projeto=p1');
  });

  it('cliente: sem "Novo" e com texto próprio quando não há nada', async () => {
    const el = await render('client', []);
    expect(el.querySelector('a.new')).toBeNull();
    expect(el.textContent).toContain('A agência ainda não preparou publicações.');
  });
});
