import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Me, TimelineEvent } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { ProjectTimeline } from './project-timeline';
import { chartMarkers, daysAgo, timelineMeta } from './timeline';

const ME: Me = {
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role: 'owner' }],
};

const EVENTS: TimelineEvent[] = [
  { id: 'e1', type: 'manual', title: 'Campanha de Black Friday no ar', description: 'Verba dobrada', occurred_on: '2026-11-10', created_by: 'Ana', manual: true },
  { id: 'e2', type: 'goal_off_track', title: 'Meta fora do ritmo: Leads', description: null, occurred_on: '2026-11-09', created_by: null, manual: false },
];

describe('helpers da linha do tempo', () => {
  it('datas relativas por dia de calendário', () => {
    const today = new Date(2026, 10, 12);
    expect(daysAgo('2026-11-12', today)).toBe('hoje');
    expect(daysAgo('2026-11-11', today)).toBe('ontem');
    expect(daysAgo('2026-11-02', today)).toBe('há 10 dias');
    expect(daysAgo('2026-10-01', today)).toBe('há 6 semanas');
  });

  it('marcos do gráfico só dentro do período, e ícone por tipo', () => {
    expect(chartMarkers(EVENTS, '2026-11-10', '2026-11-30')).toEqual([{ date: '2026-11-10', label: 'Campanha de Black Friday no ar' }]);
    expect(timelineMeta('goal_achieved').icon).toBe('target');
    expect(timelineMeta('ads_change')).toMatchObject({ label: 'Anúncios', icon: 'megaphone' });
    expect(timelineMeta('desconhecido').label).toBe('Marco');
  });
});

describe('ProjectTimeline', () => {
  let fixture: ComponentFixture<ProjectTimeline>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let changes = 0;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }
  const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(ME), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectTimeline);
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.componentRef.setInput('canEdit', true);
    fixture.componentRef.setInput('events', EVENTS);
    changes = 0;
    fixture.componentInstance.changed.subscribe(() => changes++);
    el = fixture.nativeElement as HTMLElement;
    await tick();
  });

  afterEach(() => backend.verify());

  it('lista com tipo, data e autor; só os marcos manuais têm remover', () => {
    const items = el.querySelectorAll('.item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Campanha de Black Friday no ar');
    expect(items[0].textContent).toContain('Verba dobrada');
    expect(items[0].textContent).toContain('Ana');
    expect(items[1].querySelector('.kind')?.textContent).toContain('Meta fora do ritmo');
    expect(el.querySelectorAll('button.x')).toHaveLength(1);
  });

  it('adiciona marco e avisa a página para recarregar (gráfico incluso)', async () => {
    button('Adicionar marco').click();
    await tick();
    button('Adicionar').click();
    await tick();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Descreva o marco');

    const title = el.querySelector<HTMLInputElement>('input[name="timeline_title"]')!;
    title.value = 'Novos criativos no ar';
    title.dispatchEvent(new Event('input'));
    const date = el.querySelector<HTMLInputElement>('input[name="timeline_date"]')!;
    date.value = '2026-11-05';
    date.dispatchEvent(new Event('input'));
    button('Adicionar').click();
    await tick();

    const post = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/projects/p1/timeline');
    expect(post.request.body).toEqual({ title: 'Novos criativos no ar', description: null, occurred_on: '2026-11-05' });
    post.flush({ data: {} }, { status: 201, statusText: 'Created' });
    await tick();
    expect(changes).toBe(1);
  });

  it('remove marco manual com confirmação', async () => {
    el.querySelector<HTMLButtonElement>('button.x')!.click();
    await tick();
    button('Remover').click();
    await tick();
    backend.expectOne((r) => r.method === 'DELETE' && r.url === '/api/timeline/e1').flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    expect(changes).toBe(1);
  });
});
