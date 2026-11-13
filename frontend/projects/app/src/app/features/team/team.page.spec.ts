import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { Invitation, Me, Project, Team, TeamMember } from '../../core/api/api.types';
import { AuthService } from '../../core/auth/auth.service';
import {
  assignableRoles,
  buildInviteBody,
  canManageMember,
  initials,
  projectNames,
  projectsError,
  validateInvite,
} from './team';
import { TeamPage } from './team.page';

const me = (role: string): Me => ({
  id: 'u1',
  name: 'Ana Lima',
  email: 'ana@agencia.com',
  two_factor_enabled: false,
  tenants: [{ id: 't1', name: 'Agência Norte', slug: 'norte', role }],
});

const DAY = 24 * 3600 * 1000;
const member = (over: Partial<TeamMember>): TeamMember => ({
  user_id: 'u?',
  name: '?',
  email: '?@x.com',
  role: 'analyst',
  joined_at: new Date(Date.now() - 30 * DAY).toISOString(),
  is_you: false,
  projects: [],
  ...over,
});

const ANA = member({ user_id: 'u1', name: 'Ana Lima', email: 'ana@agencia.com', role: 'owner', is_you: true });
const BRUNO = member({ user_id: 'u2', name: 'Bruno Costa', email: 'bruno@agencia.com', role: 'analyst' });
const CARLA = member({
  user_id: 'u3',
  name: 'Carla Dias',
  email: 'carla@cliente.com',
  role: 'client',
  projects: [{ id: 'p1', name: 'Padaria Aurora' }],
});
const OTTO = member({ user_id: 'u4', name: 'Otto Reis', email: 'otto@agencia.com', role: 'owner' });

const invitation = (over: Partial<Invitation>): Invitation => ({
  id: 'i?',
  email: '?@x.com',
  role: 'analyst',
  projects: [],
  invited_by: 'Ana Lima',
  created_at: new Date(Date.now() - DAY).toISOString(),
  expires_at: new Date(Date.now() + 6 * DAY).toISOString(),
  expired: false,
  ...over,
});

const DANI = invitation({ id: 'i1', email: 'dani@agencia.com', role: 'admin' });
const EDU = invitation({
  id: 'i2',
  email: 'edu@x.com',
  invited_by: null,
  expires_at: new Date(Date.now() - DAY).toISOString(),
  expired: true,
});

const TEAM: Team = { members: [ANA, BRUNO, CARLA], invitations: [DANI, EDU], can_manage_owners: true };
const PROJECTS: Project[] = [
  { id: 'p1', name: 'Padaria Aurora', niche: null, created_at: '' },
  { id: 'p2', name: 'Loja Boreal', niche: null, created_at: '' },
];

describe('helpers da equipe', () => {
  it('iniciais, papéis atribuíveis e quem pode ser gerenciado', () => {
    expect(initials('Ana Lima Souza')).toBe('AL');
    expect(initials('  ')).toBe('?');
    expect(assignableRoles(true)).toEqual(['owner', 'admin', 'analyst', 'client']);
    expect(assignableRoles(false)).toEqual(['admin', 'analyst', 'client']);
    expect(canManageMember(ANA, true)).toBe(false); // si mesmo
    expect(canManageMember(OTTO, true)).toBe(true);
    expect(canManageMember(OTTO, false)).toBe(false); // admin não mexe em dono
    expect(canManageMember(BRUNO, false)).toBe(true);
  });

  it('valida o convite e monta o corpo (projetos só para cliente)', () => {
    expect(validateInvite({ email: '', role: 'analyst', projectIds: [] })).toEqual({ email: 'Informe o e-mail da pessoa.' });
    expect(validateInvite({ email: 'x@y', role: 'client', projectIds: [] })).toEqual({
      email: 'E-mail inválido.',
      project_ids: 'Escolha ao menos um projeto para o cliente.',
    });
    expect(buildInviteBody({ email: ' Bia@Empresa.COM ', role: 'analyst', projectIds: ['p1'] })).toEqual({
      email: 'bia@empresa.com',
      role: 'analyst',
    });
    expect(buildInviteBody({ email: 'c@d.com', role: 'client', projectIds: ['p1'] })).toEqual({
      email: 'c@d.com',
      role: 'client',
      project_ids: ['p1'],
    });
  });

  it('nomes de projetos e erro do campo de projetos', () => {
    expect(projectNames(['A'])).toBe('A');
    expect(projectNames(['A', 'B', 'C'])).toBe('A, B e C');
    expect(projectNames(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C e mais 2');
    expect(projectsError({ 'project_ids.0': 'Projeto inválido.' })).toBe('Projeto inválido.');
    expect(projectsError({ email: 'x' })).toBeNull();
  });
});

describe('TeamPage', () => {
  let fixture: ComponentFixture<TeamPage>;
  let backend: HttpTestingController;
  let el: HTMLElement;
  let toast: DsToastService;

  const drain = () => new Promise<void>((resolve) => setTimeout(resolve));
  async function tick(): Promise<void> {
    await drain();
    TestBed.tick();
  }
  async function settle(): Promise<void> {
    await tick();
    await fixture.whenStable();
  }
  const row = (selector: string) => el.querySelector<HTMLElement>(selector)!;
  const memberRow = (id: string) => row(`[data-member="${id}"]`);
  const invitationRow = (id: string) => row(`[data-invitation="${id}"]`);
  const button = (text: string, scope: ParentNode = el) =>
    [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text));
  const inviteForm = () => el.querySelector<HTMLFormElement>('form[aria-label="Convidar pessoa"]')!;
  const typeEmail = (value: string) => {
    const input = el.querySelector<HTMLInputElement>('input[name=invite_email]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const chooseRole = (role: string) => {
    const radio = el.querySelector<HTMLInputElement>(`input[name=invite_role][value=${role}]`)!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
  };
  const pickProject = (scope: ParentNode, name: string) =>
    [...scope.querySelectorAll<HTMLLabelElement>('app-project-picker label')]
      .find((l) => l.textContent?.includes(name))
      ?.querySelector('input')
      ?.click();
  const selectRole = (userId: string, role: string) => {
    const select = el.querySelector<HTMLSelectElement>(`#role-${userId}`)!;
    select.value = role;
    select.dispatchEvent(new Event('change'));
  };

  async function setup(role = 'owner'): Promise<void> {
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
    fixture = TestBed.createComponent(TeamPage);
    el = fixture.nativeElement as HTMLElement;
    await tick();
  }

  async function loaded(team: Team = TEAM, role = 'owner'): Promise<void> {
    await setup(role);
    const req = backend.expectOne('/api/team');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('t1');
    req.flush({ data: team });
    backend.expectOne('/api/projects').flush({ data: PROJECTS });
    await settle();
  }

  afterEach(() => {
    backend.verify();
    localStorage.clear();
  });

  it('para quem não é dono/admin, explica e nem chama a API', async () => {
    await setup('analyst');
    await settle();

    backend.expectNone('/api/team');
    backend.expectNone('/api/projects');
    expect(el.textContent).toContain('Só donos e administradores da agência gerenciam a equipe.');
    expect(inviteForm()).toBeNull();
  });

  it('lista membros e convites pendentes com papéis, projetos e validade', async () => {
    await loaded();

    expect(memberRow('u1').textContent).toContain('você');
    expect(memberRow('u1').querySelector('select')).toBeNull(); // ninguém muda o próprio papel aqui
    expect(memberRow('u1').querySelector('.role-chip')?.textContent).toContain('Dono');
    expect([...memberRow('u2').querySelectorAll('option')].map((o) => o.textContent?.trim())).toEqual([
      'Dono',
      'Administrador',
      'Analista',
      'Cliente',
    ]);
    expect(memberRow('u2').querySelector('select')?.value).toBe('analyst');
    expect(memberRow('u3').textContent).toContain('Vê: Padaria Aurora');
    expect(button('Editar projetos', memberRow('u3'))).toBeDefined();

    expect(invitationRow('i1').textContent).toContain('Administrador');
    expect(invitationRow('i1').textContent).toContain('enviado por Ana Lima');
    expect(invitationRow('i1').textContent).toContain('expira');
    expect(invitationRow('i2').querySelector('.expired')?.textContent).toContain('expirado');
  });

  it('administrador que não é dono não mexe em donos nem promove a dono', async () => {
    await loaded({ ...TEAM, members: [ANA, OTTO, BRUNO], can_manage_owners: false }, 'admin');

    expect(memberRow('u4').querySelector('select')).toBeNull();
    expect(button('Remover', memberRow('u4'))).toBeUndefined();
    expect([...memberRow('u2').querySelectorAll('option')].map((o) => o.value)).toEqual(['admin', 'analyst', 'client']);
  });

  it('convite de cliente exige projeto; ao enviar mostra o link para copiar', async () => {
    await loaded();
    const success = vi.spyOn(toast, 'success');

    typeEmail('Novo@Cliente.com');
    chooseRole('client');
    await settle();
    expect(el.querySelector('app-project-picker')).not.toBeNull();

    inviteForm().dispatchEvent(new Event('submit'));
    await settle();
    backend.expectNone('/api/team/invitations');
    expect(el.textContent).toContain('Escolha ao menos um projeto para o cliente.');

    pickProject(inviteForm(), 'Loja Boreal');
    await settle();
    expect(el.textContent).not.toContain('Escolha ao menos um projeto para o cliente.');

    inviteForm().dispatchEvent(new Event('submit'));
    await tick();
    const req = backend.expectOne('/api/team/invitations');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'novo@cliente.com', role: 'client', project_ids: ['p2'] });
    const created = invitation({ id: 'i9', email: 'novo@cliente.com', role: 'client', projects: [{ id: 'p2', name: 'Loja Boreal' }] });
    req.flush({ data: created, invite_url: 'http://localhost:4300/convite/tok-novo' }, { status: 201, statusText: 'Created' });
    await settle();

    expect(success).toHaveBeenCalledWith('Convite enviado', { message: 'Enviamos o link para novo@cliente.com.' });
    expect(el.querySelector('.link-card code')?.textContent).toContain('http://localhost:4300/convite/tok-novo');
    expect(invitationRow('i9').textContent).toContain('Vai ver: Loja Boreal');
    expect(el.querySelector<HTMLInputElement>('input[name=invite_email]')?.value).toBe('');

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    button('Copiar link')?.click();
    await settle();
    expect(writeText).toHaveBeenCalledWith('http://localhost:4300/convite/tok-novo');
  });

  it('mostra no campo o erro do servidor (ex.: já faz parte da equipe)', async () => {
    await loaded();

    typeEmail('bruno@agencia.com');
    inviteForm().dispatchEvent(new Event('submit'));
    await tick();
    backend
      .expectOne('/api/team/invitations')
      .flush(
        { message: 'Esta pessoa já faz parte da equipe.', errors: { email: ['Esta pessoa já faz parte da equipe.'] } },
        { status: 422, statusText: 'Unprocessable Content' },
      );
    await settle();

    expect(inviteForm().querySelector('ds-text-field.has-error')?.textContent).toContain('já faz parte da equipe');
    expect(el.querySelector('.link-card')).toBeNull();
  });

  it('muda o papel na hora; se o servidor recusar, o select volta e explica', async () => {
    await loaded();

    selectRole('u2', 'admin');
    await tick();
    let req = backend.expectOne('/api/team/members/u2');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ role: 'admin' });
    req.flush({ data: { ...BRUNO, role: 'admin' } });
    await settle();
    expect(memberRow('u2').querySelector('select')?.value).toBe('admin');

    selectRole('u2', 'analyst');
    await tick();
    req = backend.expectOne('/api/team/members/u2');
    req.flush(
      { message: 'Não foi possível.', errors: { role: ['A agência precisa de pelo menos um dono.'] } },
      { status: 422, statusText: 'Unprocessable Content' },
    );
    await settle();
    expect(memberRow('u2').querySelector('.member-error')?.textContent).toContain('pelo menos um dono');
    expect(memberRow('u2').querySelector('select')?.value).toBe('admin');
  });

  it('ao virar cliente, pede os projetos antes de salvar', async () => {
    await loaded();

    selectRole('u2', 'client');
    await settle();
    backend.expectNone('/api/team/members/u2');
    expect(memberRow('u2').querySelector('app-project-picker')).not.toBeNull();

    button('Salvar', memberRow('u2'))?.click();
    await settle();
    backend.expectNone('/api/team/members/u2');
    expect(memberRow('u2').textContent).toContain('Escolha ao menos um projeto para o cliente.');

    pickProject(memberRow('u2'), 'Padaria Aurora');
    await settle();
    button('Salvar', memberRow('u2'))?.click();
    await tick();
    const req = backend.expectOne('/api/team/members/u2');
    expect(req.request.body).toEqual({ role: 'client', project_ids: ['p1'] });
    req.flush({ data: { ...BRUNO, role: 'client', projects: [{ id: 'p1', name: 'Padaria Aurora' }] } });
    await settle();

    expect(memberRow('u2').querySelector('app-project-picker')).toBeNull();
    expect(memberRow('u2').textContent).toContain('Vê: Padaria Aurora');
  });

  it('cancelar a troca para cliente devolve o papel anterior', async () => {
    await loaded();

    selectRole('u2', 'client');
    await settle();
    button('Cancelar', memberRow('u2'))?.click();
    await settle();

    expect(memberRow('u2').querySelector('app-project-picker')).toBeNull();
    expect(memberRow('u2').querySelector('select')?.value).toBe('analyst');
  });

  it('remove membro só depois de confirmar', async () => {
    await loaded();

    button('Remover', memberRow('u2'))?.click();
    await settle();
    backend.expectNone('/api/team/members/u2');
    expect(memberRow('u2').textContent).toContain('Remover Bruno Costa da agência?');

    const confirm = [...memberRow('u2').querySelectorAll('button')].find((b) => b.getAttribute('data-variant') === 'destructive');
    confirm?.click();
    await tick();
    const req = backend.expectOne('/api/team/members/u2');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(el.querySelector('[data-member="u2"]')).toBeNull();
  });

  it('reenvia (mostra o novo link) e revoga convites', async () => {
    await loaded();

    button('Reenviar', invitationRow('i2'))?.click();
    await tick();
    const resend = backend.expectOne('/api/team/invitations/i2/resend');
    expect(resend.request.method).toBe('POST');
    resend.flush({
      data: { ...EDU, expired: false, expires_at: new Date(Date.now() + 7 * DAY).toISOString() },
      invite_url: 'http://localhost:4300/convite/tok-novo-2',
    });
    await settle();
    expect(el.querySelector('.link-card')?.textContent).toContain('Novo link');
    expect(el.querySelector('.link-card code')?.textContent).toContain('tok-novo-2');
    expect(invitationRow('i2').querySelector('.expired')).toBeNull();

    button('Revogar', invitationRow('i1'))?.click();
    await tick();
    const revoke = backend.expectOne('/api/team/invitations/i1');
    expect(revoke.request.method).toBe('DELETE');
    revoke.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(el.querySelector('[data-invitation="i1"]')).toBeNull();
  });
});
