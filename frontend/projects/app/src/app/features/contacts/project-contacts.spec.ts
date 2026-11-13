import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Contact, Me } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { canReceiveAny, channelBlocker, contactBody, validateContact } from './contacts';
import { ProjectContacts } from './project-contacts';

const ME: Me = {
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role: 'owner' }],
};

export const MARINA: Contact = {
  id: 'c1',
  project_id: 'p1',
  name: 'Marina Souza',
  email: 'marina@padaria.test',
  phone: '+5511999998888',
  phone_display: '+55 (11) 99999-8888',
  role: 'Sócia',
  email_opt_in: true,
  whatsapp_opt_in: false,
  created_at: '2026-11-01T10:00:00Z',
};

describe('helpers de contatos', () => {
  it('só conta consentimento de canal preenchido e manda vazios como null', () => {
    expect(contactBody({ name: ' Ana ', role: '', email: '', phone: ' 11 99999-8888 ', email_opt_in: true, whatsapp_opt_in: true })).toEqual({
      name: 'Ana',
      role: null,
      email: null,
      phone: '11 99999-8888',
      email_opt_in: false,
      whatsapp_opt_in: true,
    });
  });

  it('exige nome e ao menos um canal', () => {
    expect(validateContact({ name: 'A', role: '', email: '', phone: '', email_opt_in: false, whatsapp_opt_in: false })).toEqual({
      name: 'Informe o nome do contato.',
      email: 'Informe ao menos um e-mail ou um WhatsApp.',
    });
  });

  it('explica por que o contato não recebe por um canal', () => {
    expect(channelBlocker(MARINA, 'email')).toBeNull();
    expect(channelBlocker(MARINA, 'whatsapp')).toBe('Sem consentimento para WhatsApp');
    expect(channelBlocker({ ...MARINA, phone: null }, 'whatsapp')).toBe('Sem WhatsApp cadastrado');
    expect(canReceiveAny(MARINA, ['whatsapp'])).toBe(false);
    expect(canReceiveAny(MARINA, ['email', 'whatsapp'])).toBe(true);
  });
});

describe('ProjectContacts', () => {
  let fixture: ComponentFixture<ProjectContacts>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }
  const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
  const input = (name: string) => el.querySelector<HTMLInputElement>(`[name="${name}"] input, input[name="${name}"]`)!;
  function type(name: string, value: string): void {
    const field = input(name);
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal(ME), status: signal('authenticated') } },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectContacts);
    fixture.componentRef.setInput('projectId', 'p1');
    el = fixture.nativeElement as HTMLElement;
    await tick();
    backend.expectOne('/api/projects/p1/contacts').flush({ data: [MARINA] });
    await tick();
  });

  afterEach(() => backend.verify());

  it('lista com o consentimento de cada canal', () => {
    const contact = el.querySelector('[data-contact="c1"]')!;
    expect(contact.textContent).toContain('Marina Souza');
    expect(contact.querySelector('[data-channel="email"]')?.classList.contains('on')).toBe(true);
    expect(contact.querySelector('[data-channel="whatsapp"]')?.classList.contains('on')).toBe(false);
  });

  it('cadastra contato, bloqueia consentimento sem canal e mostra o 422 do campo', async () => {
    button('Adicionar').click();
    await tick();
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
    expect(input('whatsapp_opt_in').disabled).toBe(true);

    type('contact_name', 'João Lima');
    type('contact_phone', '123');
    await tick();
    expect(input('whatsapp_opt_in').disabled).toBe(false);
    input('whatsapp_opt_in').click();
    await tick();

    el.querySelector<HTMLFormElement>('[role="dialog"] form')!.dispatchEvent(new Event('submit'));
    await tick();
    const req = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/projects/p1/contacts');
    expect(req.request.body).toEqual({ name: 'João Lima', role: null, email: null, phone: '123', email_opt_in: false, whatsapp_opt_in: true });
    req.flush(
      { message: 'Telefone inválido.', errors: { phone: ['Telefone inválido. Use DDD + número (ex.: 11 99999-8888) ou o formato internacional.'] } },
      { status: 422, statusText: 'Unprocessable' },
    );
    await tick();
    expect(el.querySelector('[role="dialog"]')?.textContent).toContain('Telefone inválido. Use DDD + número');
  });

  it('mostra o histórico de consentimento', async () => {
    button('Histórico').click();
    await tick();
    backend.expectOne('/api/contacts/c1/consents').flush({
      data: [{ channel: 'whatsapp', granted: false, source: 'whatsapp_reply', recorded_by: null, created_at: new Date().toISOString() }],
    });
    await tick();
    expect(el.querySelector('.history')?.textContent).toContain('Retirou WhatsApp');
    expect(el.querySelector('.history')?.textContent).toContain('respondendo PARAR');
  });

  it('remove com confirmação', async () => {
    button('Editar').click();
    await tick();
    button('Remover').click();
    await tick();
    expect(el.textContent).toContain('Remover este contato?');
    [...el.querySelectorAll('[role="dialog"] button')].filter((b) => b.textContent?.trim() === 'Remover').at(-1)!.dispatchEvent(new Event('click'));
    await tick();
    backend.expectOne((r) => r.method === 'DELETE' && r.url === '/api/contacts/c1').flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    expect(el.querySelector('[data-contact="c1"]')).toBeNull();
  });
});
