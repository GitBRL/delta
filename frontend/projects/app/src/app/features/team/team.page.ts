import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideCopy, LucideMail, LucideRotateCw, LucideUserPlus, LucideUsers, LucideX } from '@lucide/angular';
import { DsButton, DsGlassCard, DsSkeleton, DsTextField, DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import {
  API,
  ApiEnvelope,
  Invitation,
  InvitationLinkResponse,
  Project,
  ProjectRef,
  Role,
  TENANT_HEADER,
  Team,
  TeamMember,
  UpdateMemberBody,
} from '../../core/api/api.types';
import { FieldErrors, extractFieldErrors, validationMessage } from '../../core/forms/server-errors';
import { relativeTime } from '../../core/format/relative-time';
import { TenantService } from '../../core/tenant/tenant.service';
import { ProjectPicker } from './project-picker';
import {
  EMPTY_INVITE,
  INVITABLE_ROLES,
  InviteDraft,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  assignableRoles,
  buildInviteBody,
  canManageMember,
  initials,
  projectNames,
  projectsError,
  validateInvite,
} from './team';

/** Link recém-gerado (convite novo ou reenviado), mostrado para copiar. */
interface InviteLink {
  email: string;
  url: string;
  resent: boolean;
}

/** Edição dos projetos de um cliente (ao virar cliente ou em "Editar projetos"). */
interface ProjectEdit {
  userId: string;
  projectIds: readonly string[];
}

/**
 * Equipe da agência: convidar pessoas, mudar papéis, remover membros e gerenciar convites.
 * Só dono/admin chega a chamar a API; o backend confere de novo (e o banco também).
 */
@Component({
  selector: 'app-team-page',
  imports: [
    FormsModule,
    DsButton,
    DsGlassCard,
    DsSkeleton,
    DsTextField,
    ProjectPicker,
    LucideCopy,
    LucideMail,
    LucideRotateCw,
    LucideUserPlus,
    LucideUsers,
    LucideX,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './team.page.html',
  styleUrl: './team.page.css',
})
export class TeamPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(DsToastService);
  protected readonly tenant = inject(TenantService);

  protected readonly roleLabel = ROLE_LABEL;
  protected readonly roleDescription = ROLE_DESCRIPTION;
  protected readonly invitableRoles = INVITABLE_ROLES;
  protected readonly initials = initials;
  protected readonly relativeTime = relativeTime;
  protected readonly canManage = (member: TeamMember) => canManageMember(member, this.canManageOwners());

  protected readonly team = httpResource<ApiEnvelope<Team>>(() => this.adminRequest(API.team));
  protected readonly projects = httpResource<ApiEnvelope<Project[]>>(() => this.adminRequest(API.projects));

  protected readonly members = computed(() => (this.team.hasValue() ? this.team.value().data.members : []));
  protected readonly invitations = computed(() => (this.team.hasValue() ? this.team.value().data.invitations : []));
  protected readonly canManageOwners = computed(() => this.team.hasValue() && this.team.value().data.can_manage_owners);
  protected readonly roleOptions = computed(() => assignableRoles(this.canManageOwners()));
  protected readonly projectRefs = computed<ProjectRef[]>(() =>
    this.projects.hasValue() ? this.projects.value().data.map(({ id, name }) => ({ id, name })) : [],
  );

  /* ---------- Convite ---------- */
  readonly draft = signal<InviteDraft>({ ...EMPTY_INVITE });
  readonly inviteErrors = signal<FieldErrors>({});
  readonly inviting = signal(false);
  readonly lastLink = signal<InviteLink | null>(null);
  protected readonly projectsErrorMessage = computed(() => projectsError(this.inviteErrors()));

  /* ---------- Membros ---------- */
  /** Papel escolhido no select e ainda não salvo (some ao salvar ou cancelar). */
  readonly roleDrafts = signal<Readonly<Record<string, Role>>>({});
  readonly projectEdit = signal<ProjectEdit | null>(null);
  readonly memberErrors = signal<Readonly<Record<string, string>>>({});
  readonly savingMember = signal<string | null>(null);
  readonly confirmRemove = signal<string | null>(null);

  /* ---------- Convites pendentes ---------- */
  readonly busyInvitation = signal<string | null>(null);

  protected patchDraft(change: Partial<InviteDraft>): void {
    this.draft.update((d) => ({ ...d, ...change }));
    const fields = Object.keys(change).map((k) => (k === 'projectIds' ? 'project_ids' : k));
    if (fields.some((f) => this.inviteErrors()[f] || (f === 'project_ids' && this.projectsErrorMessage()))) {
      this.inviteErrors.update((all) =>
        Object.fromEntries(Object.entries(all).filter(([k]) => !fields.some((f) => k === f || k.startsWith(`${f}.`)))),
      );
    }
  }

  protected roleOf(member: TeamMember): Role {
    return this.roleDrafts()[member.user_id] ?? member.role;
  }

  protected projectNamesOf(projects: readonly ProjectRef[]): string {
    return projectNames(projects.map((p) => p.name));
  }

  /** "Enviar convite". */
  async invite(): Promise<void> {
    const headers = this.headers();
    if (!headers || this.inviting()) return;

    const draft = this.draft();
    const clientErrors = validateInvite(draft);
    this.inviteErrors.set(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;

    this.inviting.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<InvitationLinkResponse>(API.teamInvitations, buildInviteBody(draft), { headers }),
      );
      this.upsertInvitation(res.data);
      this.lastLink.set({ email: res.data.email, url: res.invite_url, resent: false });
      this.draft.set({ ...EMPTY_INVITE, role: draft.role });
      this.toast.success('Convite enviado', { message: `Enviamos o link para ${res.data.email}.` });
    } catch (error) {
      const fields = extractFieldErrors(error);
      if (fields && Object.keys(fields).length > 0) {
        this.inviteErrors.set(fields);
      } else {
        this.reportError(error, 'Não foi possível enviar o convite');
      }
    } finally {
      this.inviting.set(false);
    }
  }

  /** Select de papel. Cliente pede os projetos antes de salvar; os demais salvam na hora. */
  changeRole(member: TeamMember, role: Role): void {
    if (role === member.role && member.role !== 'client') {
      this.clearRoleDraft(member.user_id);
      return;
    }
    this.roleDrafts.update((all) => ({ ...all, [member.user_id]: role }));
    this.clearMemberError(member.user_id);

    if (role === 'client') {
      this.projectEdit.set({ userId: member.user_id, projectIds: member.projects.map((p) => p.id) });
      return;
    }
    this.projectEdit.set(null);
    void this.saveMember(member, { role });
  }

  editProjects(member: TeamMember): void {
    this.clearMemberError(member.user_id);
    this.projectEdit.set({ userId: member.user_id, projectIds: member.projects.map((p) => p.id) });
  }

  setEditProjects(projectIds: readonly string[]): void {
    this.projectEdit.update((edit) => (edit ? { ...edit, projectIds } : edit));
  }

  cancelEdit(member: TeamMember): void {
    this.projectEdit.set(null);
    this.clearRoleDraft(member.user_id);
    this.clearMemberError(member.user_id);
  }

  /** "Salvar" da edição de projetos do cliente. */
  async saveProjects(member: TeamMember): Promise<void> {
    const edit = this.projectEdit();
    if (!edit || edit.userId !== member.user_id) return;
    if (edit.projectIds.length === 0) {
      this.memberErrors.update((all) => ({ ...all, [member.user_id]: 'Escolha ao menos um projeto para o cliente.' }));
      return;
    }
    await this.saveMember(member, { role: 'client', project_ids: [...edit.projectIds] });
  }

  askRemove(member: TeamMember): void {
    this.confirmRemove.set(member.user_id);
  }

  async remove(member: TeamMember): Promise<void> {
    const headers = this.headers();
    if (!headers || this.savingMember()) return;

    this.savingMember.set(member.user_id);
    try {
      await firstValueFrom(this.http.delete(API.teamMember(member.user_id), { headers }));
      this.updateTeam((team) => ({ ...team, members: team.members.filter((m) => m.user_id !== member.user_id) }));
      this.toast.success(`${member.name} foi removido da equipe`);
    } catch (error) {
      this.memberFailure(member, error, 'Não foi possível remover');
    } finally {
      this.savingMember.set(null);
      this.confirmRemove.set(null);
    }
  }

  async resend(invitation: Invitation): Promise<void> {
    const headers = this.headers();
    if (!headers || this.busyInvitation()) return;

    this.busyInvitation.set(invitation.id);
    try {
      const res = await firstValueFrom(
        this.http.post<InvitationLinkResponse>(API.teamInvitationResend(invitation.id), {}, { headers }),
      );
      this.upsertInvitation(res.data);
      this.lastLink.set({ email: res.data.email, url: res.invite_url, resent: true });
      this.toast.success('Convite reenviado', { message: `Novo link enviado para ${res.data.email}. Vale por 7 dias.` });
    } catch (error) {
      this.reportError(error, 'Não foi possível reenviar');
    } finally {
      this.busyInvitation.set(null);
    }
  }

  async revoke(invitation: Invitation): Promise<void> {
    const headers = this.headers();
    if (!headers || this.busyInvitation()) return;

    this.busyInvitation.set(invitation.id);
    try {
      await firstValueFrom(this.http.delete(API.teamInvitation(invitation.id), { headers }));
      this.updateTeam((team) => ({ ...team, invitations: team.invitations.filter((i) => i.id !== invitation.id) }));
      if (this.lastLink()?.email === invitation.email) this.lastLink.set(null);
      this.toast.info('Convite revogado', { message: `O link enviado para ${invitation.email} não funciona mais.` });
    } catch (error) {
      this.reportError(error, 'Não foi possível revogar');
    } finally {
      this.busyInvitation.set(null);
    }
  }

  protected async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.toast.success('Link copiado', { message: 'Envie para a pessoa pelo canal que preferir.' });
    } catch {
      this.toast.error('Não foi possível copiar', { message: 'Selecione o link e copie manualmente.' });
    }
  }

  private async saveMember(member: TeamMember, body: UpdateMemberBody): Promise<void> {
    const headers = this.headers();
    if (!headers) return;

    this.savingMember.set(member.user_id);
    try {
      const res = await firstValueFrom(
        this.http.patch<ApiEnvelope<TeamMember>>(API.teamMember(member.user_id), body, { headers }),
      );
      this.updateTeam((team) => ({
        ...team,
        members: team.members.map((m) => (m.user_id === member.user_id ? res.data : m)),
      }));
      this.clearRoleDraft(member.user_id);
      this.projectEdit.set(null);
      this.toast.success('Equipe atualizada', {
        message: `${res.data.name} agora é ${ROLE_LABEL[res.data.role].toLowerCase()}.`,
      });
    } catch (error) {
      // O select volta ao papel salvo; a edição de projetos fica aberta para corrigir.
      if (body.role !== 'client') this.clearRoleDraft(member.user_id);
      this.memberFailure(member, error, 'Não foi possível mudar o papel');
    } finally {
      this.savingMember.set(null);
    }
  }

  private memberFailure(member: TeamMember, error: unknown, title: string): void {
    const fields = extractFieldErrors(error);
    const message = fields ? (Object.values(fields)[0] ?? validationMessage(error)) : null;
    if (message) {
      this.memberErrors.update((all) => ({ ...all, [member.user_id]: message }));
    } else {
      this.reportError(error, title);
    }
  }

  private upsertInvitation(invitation: Invitation): void {
    this.updateTeam((team) => ({
      ...team,
      invitations: team.invitations.some((i) => i.id === invitation.id)
        ? team.invitations.map((i) => (i.id === invitation.id ? invitation : i))
        : [invitation, ...team.invitations],
    }));
  }

  private updateTeam(change: (team: Team) => Team): void {
    this.team.update((current) => (current ? { data: change(current.data) } : current));
  }

  private clearRoleDraft(userId: string): void {
    this.roleDrafts.update((all) => {
      if (!(userId in all)) return all;
      const next = { ...all };
      delete next[userId];
      return next;
    });
  }

  private clearMemberError(userId: string): void {
    this.memberErrors.update((all) => {
      if (!(userId in all)) return all;
      const next = { ...all };
      delete next[userId];
      return next;
    });
  }

  private headers(): Record<string, string> | null {
    const tenantId = this.tenant.currentId();
    return tenantId ? { [TENANT_HEADER]: tenantId } : null;
  }

  private adminRequest(url: string) {
    const tenantId = this.tenant.currentId();
    return tenantId && this.tenant.isAdmin() ? { url, headers: { [TENANT_HEADER]: tenantId } } : undefined;
  }

  private reportError(error: unknown, title: string): void {
    // 403/5xx/rede já viram toast no interceptor global.
    if (!(error instanceof HttpErrorResponse && (error.status === 403 || error.status === 0 || error.status >= 500))) {
      this.toast.error(title, { message: validationMessage(error) ?? undefined });
    }
  }
}
