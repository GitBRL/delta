import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { Automation, AutomationRun, AutomationRunDetail, Contact, Me, ReportSummary } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import { AutomationEditorPage, PREVIEW_DEBOUNCE_MS, baseFieldErrors, recipientBlocker } from './automation-editor.page';
import { AutomationsPage } from './automations.page';
import {
  DEFAULT_MESSAGE,
  EMPTY_AUTOMATION,
  automationBody,
  insertVariable,
  isRunLive,
  suggestedPeriod,
  validateAutomation,
} from './automations';
import { RunHistory } from './run-history';

const me = (role: string): Me => ({
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const MARINA: Contact = {
  id: 'c1', project_id: 'p1', name: 'Marina Souza', email: 'marina@padaria.test', phone: '+5511999998888', phone_display: '+55 (11) 99999-8888',
  role: null, email_opt_in: true, whatsapp_opt_in: true, created_at: '2026-11-01T10:00:00Z',
};
const JOAO: Contact = { ...MARINA, id: 'c2', name: 'João', email: null, email_opt_in: false, whatsapp_opt_in: false };

const REPORT: ReportSummary = {
  id: 'r1', title: 'Relatório semanal', project: { id: 'p1', name: 'Padaria Aurora', niche: null }, template: null,
  period_preset: 'last_7', period_label: '05/11/2026 – 11/11/2026', updated_at: null,
};

const RUN: AutomationRun = {
  id: 'run1', automation_id: 'a1', automation_name: 'Semanal da padaria', project_id: 'p1', trigger: 'manual',
  status: 'awaiting_approval', scheduled_for: '2026-11-12T12:00:00Z', snapshot_id: 's1', approved_by: null, approved_at: null,
  error: null, counts: { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 }, created_at: new Date().toISOString(),
};

const AUTOMATION: Automation = {
  id: 'a1', name: 'Semanal da padaria', project: { id: 'p1', name: 'Padaria Aurora' }, report: { id: 'r1', title: 'Relatório semanal' },
  channels: ['email', 'whatsapp'], frequency: 'weekly', weekday: 1, month_day: null, send_time: '09:00', schedule_label: 'Toda segunda às 09:00',
  period_preset: 'last_7', message: DEFAULT_MESSAGE, attach_pdf: true, requires_approval: true, active: true,
  next_run_at: '2026-11-16T12:00:00Z', last_run_at: null, recipients: [MARINA], last_run: { id: 'run1', status: 'awaiting_approval', created_at: RUN.created_at },
};

describe('helpers dos envios', () => {
  it('manda o dia só quando a frequência usa e o relatório só na criação', () => {
    const draft = { ...EMPTY_AUTOMATION, name: ' Semanal ', report_id: 'r1', frequency: 'monthly' as const, month_day: 5, recipient_ids: ['c1'] };
    expect(automationBody(draft, true)).toMatchObject({ name: 'Semanal', report_id: 'r1', weekday: null, month_day: 5 });
    expect(automationBody({ ...draft, frequency: 'weekly', weekday: 3 }, false)).not.toHaveProperty('report_id');
    expect(automationBody({ ...draft, frequency: 'weekly', weekday: 3 }, false)).toMatchObject({ weekday: 3, month_day: null });
  });

  it('valida o rascunho', () => {
    expect(validateAutomation({ ...EMPTY_AUTOMATION, channels: [] }, true)).toEqual({
      name: 'Dê um nome ao envio.',
      report_id: 'Escolha o relatório.',
      channels: 'Escolha ao menos um canal.',
      recipient_ids: 'Escolha ao menos um contato.',
    });
  });

  it('insere variável no cursor e sugere o período pela frequência', () => {
    expect(insertVariable('Olá, !', 'contato', 5)).toEqual({ text: 'Olá, {{contato}}!', cursor: 16 });
    expect(suggestedPeriod('monthly')).toBe('last_month');
    expect(suggestedPeriod('biweekly')).toBe('last_14');
  });

  it('sabe quando ainda há entrega acontecendo', () => {
    const base: AutomationRunDetail = { ...RUN, status: 'sent', messages: [] };
    const msg = { id: 'm', channel: 'whatsapp' as const, recipient: '+55', contact_name: 'M', provider: 'sandbox' as const, error: null, body: null, delivered_at: null, read_at: null };
    expect(isRunLive({ ...base, messages: [{ ...msg, status: 'queued', sent_at: null }] })).toBe(true);
    expect(isRunLive({ ...base, messages: [{ ...msg, status: 'sent', sent_at: new Date().toISOString() }] })).toBe(true);
    expect(isRunLive({ ...base, messages: [{ ...msg, status: 'read', sent_at: new Date().toISOString() }] })).toBe(false);
  });

  it('explica destinatário sem consentimento e junta erros por campo', () => {
    expect(recipientBlocker(JOAO, ['email', 'whatsapp'])).toBe('Sem e-mail cadastrado · Sem consentimento para WhatsApp');
    expect(recipientBlocker(MARINA, ['whatsapp'])).toBeNull();
    expect(baseFieldErrors({ 'recipient_ids.0': 'Contato inválido.', channels: 'x' })).toEqual({ recipient_ids: 'Contato inválido.', channels: 'x' });
  });
});

function setup(role = 'owner'): HttpTestingController {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { user: signal(me(role)), status: signal('authenticated') } },
    ],
  });
  return TestBed.inject(HttpTestingController);
}

const drain = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function tick(ms = 0): Promise<void> {
  await drain(ms);
  TestBed.tick();
}

describe('AutomationEditorPage (novo envio)', () => {
  let fixture: ComponentFixture<AutomationEditorPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    localStorage.clear();
    backend = setup();
    fixture = TestBed.createComponent(AutomationEditorPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    backend.expectOne('/api/reports').flush({ data: [REPORT] });
    backend.expectOne('/api/whatsapp').flush({ data: { mode: 'sandbox' }, verification: null });
    await tick();
  });

  afterEach(() => backend.verify());

  it('mostra os contatos do cliente, bloqueia quem não consentiu e pede a prévia com debounce', async () => {
    const select = el.querySelector<HTMLSelectElement>('select[name="report_id"]')!;
    select.value = 'r1';
    select.dispatchEvent(new Event('change'));
    await tick();
    backend.expectOne('/api/projects/p1/contacts').flush({ data: [MARINA, JOAO] });
    await tick();

    const joao = el.querySelector<HTMLElement>('[data-recipient="c2"]')!;
    expect(joao.querySelector('input')!.disabled).toBe(true);
    expect(joao.textContent).toContain('Sem consentimento para WhatsApp');
    expect(el.querySelector('[data-whatsapp="sandbox"]')?.textContent).toContain('demonstração');

    el.querySelector<HTMLInputElement>('[data-recipient="c1"] input')!.click();
    await tick();
    backend.expectNone('/api/automations/preview'); // ainda dentro do debounce
    await tick(PREVIEW_DEBOUNCE_MS + 50);

    const preview = backend.expectOne('/api/automations/preview');
    expect(preview.request.body).toEqual({ report_id: 'r1', period_preset: 'last_7', message: DEFAULT_MESSAGE, contact_id: 'c1' });
    preview.flush({ data: { subject: 'Relatório Padaria Aurora · 05/11/2026 – 11/11/2026', text: 'Olá, Marina! Tudo certo.', whatsapp_params: ['Marina', 'Padaria', 'p', 'r', 'l'] } });
    await tick();
    expect(el.querySelector('[data-preview="whatsapp"]')?.textContent).toContain('Olá, Marina!');
    expect(el.querySelector('[data-preview="email"]')?.textContent).toContain('Relatório Padaria Aurora');
  });

  it('cria o envio e mostra o 422 do backend no campo', async () => {
    const select = el.querySelector<HTMLSelectElement>('select[name="report_id"]')!;
    select.value = 'r1';
    select.dispatchEvent(new Event('change'));
    await tick();
    backend.expectOne('/api/projects/p1/contacts').flush({ data: [MARINA] });
    await tick();
    el.querySelector<HTMLInputElement>('[data-recipient="c1"] input')!.click();
    const name = el.querySelector<HTMLInputElement>('[name="automation_name"] input, input[name="automation_name"]')!;
    name.value = 'Semanal da padaria';
    name.dispatchEvent(new Event('input'));
    await tick();

    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Criar envio')!.click();
    await tick();
    const req = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/automations');
    expect(req.request.body).toMatchObject({ name: 'Semanal da padaria', report_id: 'r1', recipient_ids: ['c1'], weekday: 1, month_day: null });
    req.flush({ message: 'x', errors: { 'recipient_ids.0': ['Os destinatários precisam ser contatos deste projeto.'] } }, { status: 422, statusText: 'Unprocessable' });
    await tick();
    expect(el.textContent).toContain('Os destinatários precisam ser contatos deste projeto.');

    await tick(PREVIEW_DEBOUNCE_MS + 50);
    backend.match('/api/automations/preview').forEach((r) => r.flush({ data: { subject: 's', text: 't', whatsapp_params: [] } }));
  });
});

describe('RunHistory', () => {
  let fixture: ComponentFixture<RunHistory>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    backend = setup();
    fixture = TestBed.createComponent(RunHistory);
    fixture.componentRef.setInput('automationId', 'a1');
    el = fixture.nativeElement as HTMLElement;
    await tick();
    const list = backend.expectOne((r) => r.url === '/api/automation-runs');
    expect(list.request.params.get('automation_id')).toBe('a1');
    list.flush({ data: [RUN] });
    await tick();
  });

  afterEach(() => backend.verify());

  it('aprova o envio que espera revisão e mostra os ticks de entrega', async () => {
    backend.expectOne('/api/automation-runs/run1').flush({ data: { ...RUN, messages: [] } });
    await tick();
    expect(el.textContent).toContain('Este envio espera a sua revisão');
    expect(el.querySelector('a[href="/relatorios/versoes/s1"]')).not.toBeNull();

    const toast = TestBed.inject(DsToastService);
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Aprovar e enviar'))!.click();
    await tick();
    backend.expectOne((r) => r.method === 'POST' && r.url === '/api/automation-runs/run1/approve').flush({ data: { ...RUN, status: 'sending' } });
    await tick();
    expect(toast.toasts().some((t) => t.title === 'Envio aprovado')).toBe(true);

    const sentAt = new Date(Date.now() - 10 * 60_000).toISOString();
    backend.expectOne('/api/automation-runs/run1').flush({
      data: {
        ...RUN, status: 'sent', counts: { ...RUN.counts, read: 1, skipped: 1 },
        messages: [
          { id: 'm1', channel: 'whatsapp', recipient: '+5511999998888', contact_name: 'Marina Souza', provider: 'sandbox', status: 'read', error: null, body: 'Olá', sent_at: sentAt, delivered_at: sentAt, read_at: sentAt },
          { id: 'm2', channel: 'whatsapp', recipient: '+5511988887777', contact_name: 'João', provider: null, status: 'skipped', error: 'Contato sem consentimento para WhatsApp.', body: null, sent_at: null, delivered_at: null, read_at: null },
        ],
      },
    });
    await tick();
    expect(el.querySelector('[data-message="m1"] .ticks')?.getAttribute('data-tone')).toBe('read');
    expect(el.querySelector('[data-message="m2"]')?.textContent).toContain('Contato sem consentimento para WhatsApp.');
  });
});

describe('AutomationsPage', () => {
  let fixture: ComponentFixture<AutomationsPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    localStorage.clear();
    backend = setup();
    fixture = TestBed.createComponent(AutomationsPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
    backend.expectOne('/api/automations').flush({ data: [AUTOMATION] });
    backend.expectOne((r) => r.url === '/api/automation-runs' && r.params.get('status') === 'awaiting_approval').flush({ data: [RUN] });
    await tick();
  });

  afterEach(() => backend.verify());

  it('lista os envios e aprova direto do aviso de pendências', async () => {
    const row = el.querySelector('[data-automation="a1"]')!;
    expect(row.textContent).toContain('Toda segunda às 09:00');
    expect(row.textContent).toContain('Aguardando aprovação');
    expect(el.textContent).toContain('1 envio aguardando aprovação');

    [...el.querySelectorAll<HTMLButtonElement>('[data-pending] button')].find((b) => b.textContent?.includes('Aprovar'))!.click();
    await tick();
    backend.expectOne('/api/automation-runs/run1/approve').flush({ data: { ...RUN, status: 'sending' } });
    await tick();
    backend.expectOne('/api/automations').flush({ data: [AUTOMATION] });
    await tick();
    expect(el.querySelector('[data-pending]')).toBeNull();
  });
});
