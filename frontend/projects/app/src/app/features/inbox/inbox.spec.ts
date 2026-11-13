import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { InboxConversation, InboxThread, Me, Role } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { tenantInterceptor } from '../../core/http/interceptors';
import { INBOX_POLL_MS, dayLabel, groupByDay, lastMessagePreview, normalizePhone, windowClosesText } from './inbox';
import { InboxPage } from './inbox.page';

const NOW = new Date();
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const OPEN: InboxConversation = {
  phone: '+5511999990001',
  phone_display: '+55 11 99999-0001',
  contact: { id: 'c1', name: 'Marina Souza', project_id: 'p1' },
  last_message: { direction: 'in', body: 'Podemos aumentar a verba?', created_at: inHours(-1) },
  unread: 2,
  window_open: true,
};
const CLOSED: InboxConversation = {
  phone: '+5521988880002',
  phone_display: '+55 21 98888-0002',
  contact: null,
  last_message: { direction: 'out', body: 'Combinado!', created_at: inHours(-50) },
  unread: 0,
  window_open: false,
};

const THREAD_OPEN: InboxThread = {
  phone: OPEN.phone,
  phone_display: OPEN.phone_display,
  contact: OPEN.contact,
  window_open: true,
  window_closes_at: inHours(23),
  messages: [
    { id: 'm1', direction: 'out', body: 'Relatório de outubro pronto.', status: 'read', created_at: inHours(-2) },
    { id: 'm2', direction: 'in', body: 'Podemos aumentar a verba?', status: 'received', created_at: inHours(-1) },
  ],
};
const THREAD_CLOSED: InboxThread = {
  phone: CLOSED.phone,
  phone_display: CLOSED.phone_display,
  contact: null,
  window_open: false,
  window_closes_at: inHours(-26),
  messages: [{ id: 'm9', direction: 'in', body: 'Oi', status: 'received', created_at: inHours(-50) }],
};

describe('helpers da caixa de conversas', () => {
  it('prévia marca o que a agência mandou', () => {
    expect(lastMessagePreview(OPEN)).toBe('Podemos aumentar a verba?');
    expect(lastMessagePreview(CLOSED)).toBe('Você: Combinado!');
  });

  it('rótulos de dia e do fim da janela', () => {
    const now = new Date(2026, 10, 12, 10, 0);
    expect(dayLabel(new Date(2026, 10, 12, 8, 0).toISOString(), now)).toBe('Hoje');
    expect(dayLabel(new Date(2026, 10, 11, 23, 0).toISOString(), now)).toBe('Ontem');
    expect(dayLabel(new Date(2026, 10, 5, 9, 0).toISOString(), now)).toBe('05/11');
    expect(windowClosesText(new Date(2026, 10, 12, 15, 40).toISOString(), now)).toBe('15:40');
    expect(windowClosesText(new Date(2026, 10, 13, 9, 12).toISOString(), now)).toBe('amanhã às 09:12');
    expect(windowClosesText(new Date(2026, 10, 14, 9, 12).toISOString(), now)).toBe('14/11 às 09:12');
  });

  it('agrupa mensagens por dia e normaliza o telefone', () => {
    const now = new Date(2026, 10, 12, 10, 0);
    const groups = groupByDay(
      [
        { id: 'a', direction: 'in', body: '1', status: null, created_at: new Date(2026, 10, 11, 9, 0).toISOString() },
        { id: 'b', direction: 'out', body: '2', status: 'sent', created_at: new Date(2026, 10, 11, 9, 5).toISOString() },
        { id: 'c', direction: 'in', body: '3', status: null, created_at: new Date(2026, 10, 12, 8, 0).toISOString() },
      ],
      now,
    );
    expect(groups.map((g) => [g.day, g.messages.length])).toEqual([
      ['Ontem', 2],
      ['Hoje', 1],
    ]);
    expect(normalizePhone('+55 (11) 99999-0001')).toBe('+5511999990001');
    expect(normalizePhone('1234')).toBeNull();
  });
});

describe('InboxPage', () => {
  let fixture: ComponentFixture<InboxPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let toast: DsToastService;
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
  const items = () => [...el.querySelectorAll<HTMLButtonElement>('.item')];
  const textarea = () => el.querySelector<HTMLTextAreaElement>('textarea[name="reply"]')!;
  const button = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().startsWith(text));

  async function mount(role: Role = 'owner', mode: 'sandbox' | 'cloud' = 'sandbox', list = [OPEN, CLOSED]): Promise<void> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([tenantInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(DsToastService);
    fixture = TestBed.createComponent(InboxPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    const req = backend.expectOne('/api/whatsapp/conversations');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    req.flush({ data: list, meta: { mode } });
    backend.expectNone('/api/whatsapp'); // o modo vem na lista: ninguém precisa da tela de configurações
    await tick();
  }

  async function openFirst(thread: InboxThread = THREAD_OPEN, index = 0): Promise<void> {
    items()[index].click();
    await tick();
    const digits = thread.phone.replace('+', '');
    backend.expectOne(`/api/whatsapp/conversations/${digits}`).flush({ data: thread });
    await tick();
  }

  afterEach(() => {
    vi.useRealTimers();
    backend.verify();
  });

  it('lista as conversas com não lidas e janela aberta', async () => {
    await mount();

    expect(items()).toHaveLength(2);
    expect(items()[0].textContent).toContain('Marina Souza');
    expect(items()[0].querySelector('.unread')?.textContent?.trim()).toBe('2');
    expect(items()[0].textContent).toContain('Janela aberta');
    expect(items()[1].textContent).toContain('+55 21 98888-0002'); // sem contato: o telefone
    expect(items()[1].textContent).toContain('Você: Combinado!');
    expect(items()[1].querySelector('.unread')).toBeNull();
  });

  it('abre a conversa pelos dígitos do telefone, zera as não lidas e responde dentro da janela', async () => {
    await mount();
    await openFirst();

    expect(el.classList.contains('has-selection')).toBe(true);
    expect(el.querySelector('.thread-head h2')?.textContent).toContain('Marina Souza');
    expect(el.querySelector('.thread-head a')?.getAttribute('href')).toBe('/projetos/p1');
    expect([...el.querySelectorAll('.bubble')].map((b) => b.getAttribute('data-dir'))).toEqual(['out', 'in']);
    expect(el.querySelector('.bubble[data-dir="out"] .meta')?.textContent).toContain('Lida');
    expect(el.querySelector('[data-testid="window-open"]')?.textContent).toContain('Janela aberta até');
    expect(items()[0].querySelector('.unread')).toBeNull();

    textarea().value = 'Podemos sim, vamos subir 20%.';
    textarea().dispatchEvent(new Event('input'));
    await tick();
    el.querySelector('form.composer')!.dispatchEvent(new Event('submit'));
    await tick();

    const req = backend.expectOne('/api/whatsapp/conversations/5511999990001/reply');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ text: 'Podemos sim, vamos subir 20%.' });
    req.flush({ data: { id: 'm3', direction: 'out', body: 'Podemos sim, vamos subir 20%.', status: 'sent', created_at: new Date().toISOString() } }, { status: 201, statusText: 'Created' });
    await tick();
    backend.expectOne('/api/whatsapp/conversations').flush({ data: [{ ...OPEN, unread: 0 }, CLOSED] });
    await tick();

    expect(el.querySelectorAll('.bubble')).toHaveLength(3);
    expect(textarea().value).toBe('');
  });

  it('fora da janela de 24 h, o compositor fica desabilitado e explica a regra', async () => {
    await mount();
    await openFirst(THREAD_CLOSED, 1);

    expect(textarea().disabled).toBe(true);
    expect(el.querySelector('[data-testid="window-closed"]')?.textContent).toContain('24 horas');
    expect(button('Enviar')?.disabled).toBe(true);
  });

  it('mostra o erro 422 do servidor (janela fechou no meio) e recarrega a conversa', async () => {
    await mount();
    await openFirst();

    textarea().value = 'Oi';
    textarea().dispatchEvent(new Event('input'));
    await tick();
    el.querySelector('form.composer')!.dispatchEvent(new Event('submit'));
    await tick();
    backend.expectOne('/api/whatsapp/conversations/5511999990001/reply').flush(
      { message: 'x', errors: { text: ['Fora da janela de 24 horas desde a última mensagem do cliente.'] } },
      { status: 422, statusText: 'Unprocessable Content' },
    );
    await tick();
    backend.expectOne('/api/whatsapp/conversations/5511999990001').flush({ data: { ...THREAD_OPEN, window_open: false } });
    await tick();

    expect(el.querySelector('.composer [role="alert"]')?.textContent).toContain('Fora da janela');
    expect(textarea().disabled).toBe(true);
  });

  it('no modo demonstração, simula a mensagem de um cliente e abre a conversa', async () => {
    await mount('owner', 'sandbox', []);
    const success = vi.spyOn(toast, 'success');
    expect(el.textContent).toContain('Nenhuma conversa ainda');

    button('Simular mensagem do cliente')!.click();
    await tick();
    const phone = el.querySelector<HTMLInputElement>('input[name="sim_phone"]')!;
    const text = el.querySelector<HTMLInputElement>('input[name="sim_text"]')!;
    phone.value = '+55 11 99999-0001';
    phone.dispatchEvent(new Event('input'));
    text.value = 'Obrigado pelo relatório!';
    text.dispatchEvent(new Event('input'));
    await tick();
    el.querySelector<HTMLFormElement>('.sim-form')!.dispatchEvent(new Event('submit'));
    await tick();

    const req = backend.expectOne('/api/whatsapp/simulate-inbound');
    expect(req.request.body).toEqual({ phone: '+5511999990001', text: 'Obrigado pelo relatório!' });
    req.flush({ data: { id: 'm1', phone: '+5511999990001' } }, { status: 201, statusText: 'Created' });
    await tick();
    backend.expectOne('/api/whatsapp/conversations').flush({ data: [OPEN] });
    backend.expectOne('/api/whatsapp/conversations/5511999990001').flush({ data: THREAD_OPEN });
    await tick();

    expect(success).toHaveBeenCalledWith('Mensagem simulada', expect.anything());
    expect(el.querySelector('.thread-head h2')?.textContent).toContain('Marina Souza');
  });

  it('número oficial: sem simulação para ninguém', async () => {
    await mount('owner', 'cloud');
    expect(button('Simular mensagem do cliente')).toBeUndefined();
    TestBed.resetTestingModule();

    await mount('analyst', 'cloud');
    expect(button('Simular mensagem do cliente')).toBeUndefined();
    expect(items()).toHaveLength(2);
  });

  it('em demonstração, o analista também simula (o modo vem na lista)', async () => {
    await mount('analyst', 'sandbox');
    expect(button('Simular mensagem do cliente')).toBeDefined();
  });

  it('atualiza a lista e a conversa aberta a cada 15 s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await mount();
    await openFirst();

    vi.advanceTimersByTime(INBOX_POLL_MS);
    await tick();
    backend.expectOne('/api/whatsapp/conversations').flush({ data: [OPEN, CLOSED] });
    backend.expectOne('/api/whatsapp/conversations/5511999990001').flush({ data: THREAD_OPEN });
    await tick();
  });
});
