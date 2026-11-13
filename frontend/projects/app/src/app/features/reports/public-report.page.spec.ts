import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { PublicReport } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { credentialsInterceptor, errorInterceptor, tenantInterceptor } from '../../core/http/interceptors';
import { PublicReportPage } from './public-report.page';
import { REPORT_DATA } from './report-fixtures';

const TOKEN = 'a'.repeat(40);
const PUBLIC: PublicReport = {
  title: 'Relatório de outubro',
  agency: 'Agência Norte',
  published_at: '2026-11-12T10:00:00Z',
  report: REPORT_DATA,
  pdf_status: 'ready',
  pdf_url: `/api/public/reports/${TOKEN}/pdf?expires=1&signature=x`,
};

describe('PublicReportPage', () => {
  let fixture: ComponentFixture<PublicReportPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let navigate: ReturnType<typeof vi.spyOn>;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
    await drain();
  }

  async function setup(inputs: Record<string, unknown> = {}): Promise<void> {
    document.documentElement.setAttribute('data-theme', 'dark');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([credentialsInterceptor, tenantInterceptor, errorInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(null), status: signal('guest'), clear: vi.fn() } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    fixture = TestBed.createComponent(PublicReportPage);
    fixture.componentRef.setInput('token', TOKEN);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    el = fixture.nativeElement as HTMLElement;
    await tick();
  }

  afterEach(() => {
    backend.verify();
    document.documentElement.removeAttribute('data-theme');
  });

  it('abre direto quando não há senha, em tema claro, com "Feito com Delta"', async () => {
    await setup();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    const req = backend.expectOne(`/api/public/reports/${TOKEN}`);
    expect(req.request.headers.has('X-Tenant-Id')).toBe(false);
    req.flush({ data: PUBLIC });
    await tick();

    expect(el.querySelector('app-report-view .cover')?.textContent).toContain('Relatório de outubro');
    expect(el.textContent).toContain('Baixar PDF');
    expect(el.textContent).toContain('Feito com Delta');

    fixture.destroy();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark'); // devolve a preferência
  });

  it('aplica a marca da agência: logo, cor de destaque e sem "Feito com Delta"', async () => {
    await setup();
    backend.expectOne(`/api/public/reports/${TOKEN}`).flush({
      data: {
        ...PUBLIC,
        branding: { name: 'Norte Digital', color: '#ff375f', logo_url: '/api/public/branding/t1/logo?signature=x', hide_delta_badge: true },
      },
    });
    await tick();

    const page = el.querySelector<HTMLElement>('.page')!;
    expect(page.style.getPropertyValue('--ds-accent')).toBe('#ff375f');
    expect(el.querySelector<HTMLImageElement>('.bar img.brand-logo')?.getAttribute('src')).toContain('/api/public/branding/t1/logo');
    const cover = el.querySelector<HTMLElement>('app-report-view .cover')!;
    expect(cover.style.getPropertyValue('--brand-color')).toBe('#ff375f');
    expect(cover.querySelector('img.brand-logo')).not.toBeNull();
    expect(cover.querySelector('.agency')?.textContent).toContain('Norte Digital');
    expect(el.textContent).not.toContain('Feito com Delta');
  });

  it('pede a senha (401 sem ir para o login), recusa a errada e abre com a certa', async () => {
    await setup();
    backend
      .expectOne(`/api/public/reports/${TOKEN}`)
      .flush({ requires_password: true, title: 'Relatório de outubro', agency: 'Agência Norte' }, { status: 401, statusText: 'Unauthorized' });
    await tick();

    expect(navigate).not.toHaveBeenCalled();
    expect(el.querySelector('form[aria-label="Senha do relatório"]')?.textContent).toContain('Relatório de outubro');

    const input = el.querySelector<HTMLInputElement>('input[name="report_password"]')!;
    input.value = 'errada';
    input.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await tick();
    backend
      .expectOne((r) => r.method === 'POST' && r.url === `/api/public/reports/${TOKEN}/unlock`)
      .flush({ message: 'Senha incorreta.', errors: { password: ['Senha incorreta.'] } }, { status: 422, statusText: 'Unprocessable' });
    await tick();
    expect(el.querySelector('.error')?.textContent).toContain('Senha incorreta.');

    input.value = 'aurora';
    input.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await tick();
    const unlock = backend.expectOne((r) => r.method === 'POST' && r.url === `/api/public/reports/${TOKEN}/unlock`);
    expect(unlock.request.body).toEqual({ password: 'aurora' });
    unlock.flush({ data: PUBLIC });
    await tick();
    expect(el.querySelector('app-report-view')).not.toBeNull();
  });

  it('explica link desativado/expirado (410) e inexistente (404)', async () => {
    await setup();
    backend.expectOne(`/api/public/reports/${TOKEN}`).flush({ message: 'Este link expirou. Peça um novo à agência.' }, { status: 410, statusText: 'Gone' });
    await tick();
    expect(el.textContent).toContain('Este link expirou. Peça um novo à agência.');
  });

  const LIVE: PublicReport = { ...PUBLIC, live: true, refreshed_at: new Date(Date.now() - 2 * 60_000).toISOString(), pdf_status: null, pdf_url: null };

  it('dashboard ao vivo: selo "Ao vivo", sem PDF e recarga silenciosa (mantém os números se a rede falhar)', async () => {
    await setup();
    backend.expectOne(`/api/public/reports/${TOKEN}`).flush({ data: LIVE });
    await tick();

    expect(el.querySelector('.live')?.textContent).toContain('Ao vivo · atualizado há 2 minutos');
    expect(el.textContent).not.toContain('Baixar PDF');
    expect(el.textContent).toContain('Modo TV');

    void fixture.componentInstance.refresh();
    await tick();
    backend.expectOne(`/api/public/reports/${TOKEN}`).flush({ message: 'erro' }, { status: 500, statusText: 'Server Error' });
    await tick();
    expect(el.querySelector('app-report-view')).not.toBeNull(); // segue mostrando

    void fixture.componentInstance.refresh();
    await tick();
    backend.expectOne(`/api/public/reports/${TOKEN}`).flush({ message: 'Este link foi desativado pela agência.' }, { status: 410, statusText: 'Gone' });
    await tick();
    expect(el.textContent).toContain('Este link foi desativado pela agência.');
  });

  it('recarga ao vivo de link com senha usa a senha aceita, só em memória', async () => {
    await setup();
    backend
      .expectOne(`/api/public/reports/${TOKEN}`)
      .flush({ requires_password: true, title: 'Painel', agency: null }, { status: 401, statusText: 'Unauthorized' });
    await tick();
    const input = el.querySelector<HTMLInputElement>('input[name="report_password"]')!;
    input.value = 'aurora';
    input.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await tick();
    backend.expectOne((r) => r.method === 'POST' && r.url === `/api/public/reports/${TOKEN}/unlock`).flush({ data: LIVE });
    await tick();

    void fixture.componentInstance.refresh();
    await tick();
    const again = backend.expectOne((r) => r.method === 'POST' && r.url === `/api/public/reports/${TOKEN}/unlock`);
    expect(again.request.body).toEqual({ password: 'aurora' });
    again.flush({ data: LIVE });
    await tick();
  });

  it('abre direto no modo TV com ?tv=1 (tema escuro, sem rodapé) e sai para a página', async () => {
    await setup({ tv: '1' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    backend.expectOne(`/api/public/reports/${TOKEN}`).flush({ data: LIVE });
    await tick();

    expect(el.querySelector('app-tv-view')).not.toBeNull();
    expect(el.textContent).not.toContain('Feito com Delta');

    fixture.componentInstance.setTv(false);
    await tick();
    expect(el.querySelector('app-tv-view')).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(el.textContent).toContain('Feito com Delta');
  });

  it('baixa o PDF pela URL assinada', async () => {
    await setup();
    backend.expectOne(`/api/public/reports/${TOKEN}`).flush({ data: PUBLIC });
    await tick();
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Baixar PDF'))!.click();
    await tick();
    const req = backend.expectOne(PUBLIC.pdf_url!);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['%PDF-1.7']), { status: 200, statusText: 'OK' });
    await tick();
  });
});
