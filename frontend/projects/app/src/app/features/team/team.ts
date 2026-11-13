import { InvitableRole, InviteBody, Role, TeamMember } from '../../core/api/api.types';
import { FieldErrors } from '../../core/forms/server-errors';

export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  owner: 'Dono',
  admin: 'Administrador',
  analyst: 'Analista',
  client: 'Cliente',
};

/** O que cada papel pode fazer, em uma linha (formulário de convite e tela do convite). */
export const ROLE_DESCRIPTION: Readonly<Record<Role, string>> = {
  owner: 'tudo de administrador, mais gerenciar outros donos',
  admin: 'gerencia equipe, apps e tudo da agência',
  analyst: 'conecta contas, cria projetos, relatórios e indicadores',
  client: 'vê só os projetos escolhidos',
};

export const INVITABLE_ROLES: readonly InvitableRole[] = ['admin', 'analyst', 'client'];

export interface InviteDraft {
  email: string;
  role: InvitableRole;
  projectIds: readonly string[];
}

export const EMPTY_INVITE: InviteDraft = { email: '', role: 'analyst', projectIds: [] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Iniciais para o avatar ("Ana Lima" → "AL"). */
export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

/** Papéis que o usuário atual pode atribuir (só dono promove a dono). */
export function assignableRoles(canManageOwners: boolean): Role[] {
  return canManageOwners ? ['owner', 'admin', 'analyst', 'client'] : ['admin', 'analyst', 'client'];
}

/**
 * Pode mudar papel/remover este membro? Ninguém mexe em si mesmo por aqui (evita se trancar
 * para fora) e só dono mexe em dono. O backend confere de novo.
 */
export function canManageMember(member: TeamMember, canManageOwners: boolean): boolean {
  return !member.is_you && (canManageOwners || member.role !== 'owner');
}

/** Validação mínima antes de chamar a API (o backend é a fonte da verdade). */
export function validateInvite(draft: InviteDraft): FieldErrors {
  const errors: FieldErrors = {};
  const email = draft.email.trim();
  if (!email) errors['email'] = 'Informe o e-mail da pessoa.';
  else if (!EMAIL.test(email)) errors['email'] = 'E-mail inválido.';
  if (draft.role === 'client' && draft.projectIds.length === 0) {
    errors['project_ids'] = 'Escolha ao menos um projeto para o cliente.';
  }
  return errors;
}

/** Corpo do convite: e-mail normalizado; projetos só para cliente. */
export function buildInviteBody(draft: InviteDraft): InviteBody {
  const body: InviteBody = { email: draft.email.trim().toLowerCase(), role: draft.role };
  if (draft.role === 'client') body.project_ids = [...draft.projectIds];
  return body;
}

/** Mensagem de erro do servidor para o campo de projetos ("project_ids" ou "project_ids.0"). */
export function projectsError(errors: FieldErrors): string | null {
  const key = Object.keys(errors).find((k) => k === 'project_ids' || k.startsWith('project_ids.'));
  return key ? (errors[key] ?? null) : null;
}

/** "Padaria Aurora, Loja Boreal e mais 2". */
export function projectNames(names: readonly string[], max = 3): string {
  if (names.length <= max) {
    if (names.length <= 1) return names[0] ?? '';
    return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
  }
  return `${names.slice(0, max).join(', ')} e mais ${names.length - max}`;
}
