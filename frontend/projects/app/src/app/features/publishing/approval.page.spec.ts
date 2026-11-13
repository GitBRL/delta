import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PublicApproval } from '../../core/api/api.types';
import { ApprovalPage } from './approval.page';
import { IMAGE, VIDEO } from './publishing-fixtures';

const TOKEN = 'a'.repeat(48);

const DATA: PublicApproval = {
  brand: { name: 'Norte Digital', color: '#ff375f', logo_url: '/api/public/branding/t1/logo?signature=x', hide_delta_badge: false },
  project: { name: 'Padaria Aurora' },
  post: {
    title: 'Pão de fermentação natural',
    caption: 'Fornada nova!\n#padaria',
    media: [IMAGE, VIDEO],
    scheduled_at: '2026-12-01T15:00:00Z',
    targets: [
      { network: 'instagram', network_label: 'Instagram', format: 'carousel', account: '@padaria' },
      { network: 'facebook', network_label: 'Facebook', format: 'feed', account: 'Padaria Aurora' },
    ],
  },
  approval: { state: 'open', decision: null, comment: null, decided_at: null, expires_at: '2026-11-26T10:00:00Z' },
};

describe('ApprovalPage', () => {
  let fixture: ComponentFixture<ApprovalPage>;
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

  async function mount(response: PublicApproval | { status: number }): Promise<void> {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ApprovalPage);
    fixture.componentRef.setInput('token', TOKEN);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    const req = backend.expectOne(`/api/public/approvals/${TOKEN}`);
    expect(req.request.headers.has('X-Tenant-Id')).toBe(false);
    if ('status' in response) req.flush({ message: 'x' }, { status: response.status, statusText: 'x' });
    else req.flush({ data: response });
    await tick();
  }

  afterEach(() => {
    backend.verify();
    document.documentElement.removeAttribute('data-theme');
  });

  it('mostra a marca da agência, as mídias, a legenda e onde vai sair', async () => {
    await mount(DATA);
    expect(el.querySelector<HTMLElement>('.page')?.style.getPropertyValue('--ds-accent')).toBe('#ff375f');
    expect(el.querySelector('img.logo')?.getAttribute('src')).toBe(DATA.brand.logo_url);
    expect(el.querySelector('h1')?.textContent).toContain('Pão de fermentação natural');
    expect(el.querySelectorAll('.slide').length).toBe(2);
    expect(el.querySelector('.slide video')?.getAttribute('src')).toBe(VIDEO.url);
    expect(el.querySelector('.caption')?.textContent).toContain('Fornada nova!');
    const where = el.querySelector('.where')?.textContent ?? '';
    expect(where).toContain('Instagram · Carrossel · @padaria');
    expect(where).toContain('Facebook · Feed');
    expect(el.textContent).toContain('Feito com Delta');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('aprovar envia a decisão (com nome) e agradece', async () => {
    await mount(DATA);
    const name = el.querySelector<HTMLInputElement>('input[name="name"]')!;
    name.value = ' Marina ';
    name.dispatchEvent(new Event('input'));
    button('Aprovar')!.click();
    await tick();
    const req = backend.expectOne((r) => r.method === 'POST' && r.url === `/api/public/approvals/${TOKEN}`);
    expect(req.request.body).toEqual({ decision: 'approved', name: 'Marina' });
    req.flush({ data: { status: 'approved', decision: 'approved' } });
    await tick();
    expect(el.querySelector('[data-testid="done"]')?.textContent).toContain('Obrigado! Post aprovado.');
    expect(el.querySelector('[data-testid="decide"]')).toBeNull();
  });

  it('pedir ajuste exige o comentário', async () => {
    await mount(DATA);
    button('Pedir ajuste')!.click();
    await tick();
    button('Enviar pedido de ajuste')!.click();
    await tick();
    expect(el.textContent).toContain('Conte o que precisa ser ajustado.');
    backend.expectNone((r) => r.method === 'POST');

    const comment = el.querySelector<HTMLTextAreaElement>('textarea[name="comment"]')!;
    comment.value = 'Trocar a foto';
    comment.dispatchEvent(new Event('input'));
    button('Enviar pedido de ajuste')!.click();
    await tick();
    const req = backend.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toEqual({ decision: 'changes_requested', comment: 'Trocar a foto' });
    req.flush({ data: { status: 'changes_requested', decision: 'changes_requested' } });
    await tick();
    expect(el.textContent).toContain('A agência vai ajustar o post.');
  });

  it('mostra o erro do servidor (já respondido)', async () => {
    await mount(DATA);
    button('Aprovar')!.click();
    await tick();
    backend
      .expectOne((r) => r.method === 'POST')
      .flush({ message: 'x', errors: { decision: ['Este post já foi respondido. Obrigado!'] } }, { status: 422, statusText: 'x' });
    await tick();
    expect(el.textContent).toContain('Este post já foi respondido. Obrigado!');
  });

  it('estados: já respondido, expirado e link inválido; selo oculto', async () => {
    await mount({ ...DATA, brand: { ...DATA.brand, hide_delta_badge: true }, approval: { ...DATA.approval, state: 'decided', decision: 'changes_requested', comment: 'Trocar a foto', decided_at: '2026-11-12T12:00:00Z' } });
    expect(el.querySelector('[data-testid="decided"]')?.textContent).toContain('Você já pediu ajustes neste post.');
    expect(el.querySelector('[data-testid="decided"]')?.textContent).toContain('Trocar a foto');
    expect(button('Aprovar')).toBeUndefined();
    expect(el.textContent).not.toContain('Feito com Delta');
  });

  it('expirado', async () => {
    await mount({ ...DATA, approval: { ...DATA.approval, state: 'expired' } });
    expect(el.querySelector('[data-testid="expired"]')?.textContent).toContain('Este link expirou ou foi substituído.');
  });

  it('link inválido', async () => {
    await mount({ status: 404 });
    expect(el.textContent).toContain('Link de aprovação inválido');
  });
});
