import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Me, ShareLink } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { LiveLinks, tvUrl } from './live-links';

const ME: Me = {
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role: 'owner' }],
};

const LINK: ShareLink = {
  id: 'l1',
  snapshot_id: null,
  report_id: 'r1',
  live: true,
  protected: true,
  expires_at: null,
  revoked_at: null,
  active: true,
  view_count: 3,
  last_viewed_at: null,
  created_at: '2026-11-12T10:00:00Z',
};

describe('LiveLinks (dashboard ao vivo)', () => {
  let fixture: ComponentFixture<LiveLinks>;
  let backend: HttpTestingController;
  let el: HTMLElement;

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
    fixture = TestBed.createComponent(LiveLinks);
    fixture.componentRef.setInput('reportId', 'r1');
    el = fixture.nativeElement as HTMLElement;
    await tick();
    const req = backend.expectOne('/api/reports/r1/links');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    req.flush({ data: [LINK] });
    await tick();
  });

  afterEach(() => backend.verify());

  it('monta o endereço do modo TV', () => {
    expect(tvUrl('http://x/r/abc')).toBe('http://x/r/abc?tv=1');
    expect(tvUrl('http://x/r/abc?a=1')).toBe('http://x/r/abc?a=1&tv=1');
  });

  it('lista os links ao vivo com visualizações e cadeado', () => {
    const item = el.querySelector('[data-link="l1"]')!;
    expect(item.textContent).toContain('3 visualizações');
    expect(item.textContent).toContain('🔒');
    expect(item.textContent).toContain('Sem validade');
  });

  it('cria o link com senha e validade e oferece copiar e abrir o modo TV', async () => {
    const pwd = el.querySelector<HTMLInputElement>('input[name="live_password"]')!;
    pwd.value = 'abc';
    pwd.dispatchEvent(new Event('input'));
    button('Criar link ao vivo').click();
    await tick();
    expect(el.textContent).toContain('pelo menos 4 caracteres');

    pwd.value = 'aurora';
    pwd.dispatchEvent(new Event('input'));
    const select = el.querySelector<HTMLSelectElement>('select[name="live_validity"]')!;
    select.value = '30';
    select.dispatchEvent(new Event('change'));
    button('Criar link ao vivo').click();
    await tick();

    const post = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/reports/r1/links');
    expect(post.request.body).toEqual({ expires_in_days: 30, password: 'aurora' });
    post.flush({ data: { ...LINK, id: 'l2' }, url: 'http://localhost:4300/r/' + 'x'.repeat(40) });
    await tick();
    backend.expectOne('/api/reports/r1/links').flush({ data: [LINK] });
    await tick();

    expect(el.querySelector<HTMLInputElement>('.url')?.value).toBe('http://localhost:4300/r/' + 'x'.repeat(40));
    expect(el.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe('http://localhost:4300/r/' + 'x'.repeat(40) + '?tv=1');
  });

  it('desativa um link', async () => {
    button('Desativar').click();
    await tick();
    backend.expectOne((r) => r.method === 'DELETE' && r.url === '/api/links/l1').flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    backend.expectOne('/api/reports/r1/links').flush({ data: [{ ...LINK, active: false, revoked_at: '2026-11-12T11:00:00Z' }] });
    await tick();
    expect(el.querySelector('[data-link="l1"]')?.textContent).toContain('Desativado');
  });
});
