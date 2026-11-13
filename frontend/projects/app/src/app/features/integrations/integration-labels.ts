import { StatusLevel } from 'design-system';
import { AccountKind, Connection, ConnectionStatus, ProviderCategory } from '../../core/api/api.types';

export const CATEGORY_LABEL: Record<ProviderCategory, string> = {
  ads: 'Mídia paga',
  social: 'Redes sociais',
  analytics: 'Analytics',
  seo: 'Busca orgânica',
  local: 'Negócio local',
};

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  ad_account: 'Conta de anúncios',
  page: 'Página',
  property: 'Propriedade',
  profile: 'Perfil',
  site: 'Site',
  channel: 'Canal',
  location: 'Unidade',
};

const STATUS: Record<ConnectionStatus, { level: StatusLevel; label: string; pulse: boolean }> = {
  active: { level: 'healthy', label: 'Ativa', pulse: false },
  syncing: { level: 'opportunity', label: 'Sincronizando', pulse: true },
  error: { level: 'critical', label: 'Com erro', pulse: true },
  expired: { level: 'critical', label: 'Acesso expirado', pulse: true },
};

export function connectionStatus(status: ConnectionStatus): { level: StatusLevel; label: string; pulse: boolean } {
  return STATUS[status];
}

export function hasSyncing(connections: readonly Connection[]): boolean {
  return connections.some((c) => c.status === 'syncing');
}

/** Substitui (por id) ou acrescenta uma conexão na lista. */
export function upsertConnection(list: readonly Connection[], connection: Connection): Connection[] {
  const index = list.findIndex((c) => c.id === connection.id);
  if (index === -1) return [connection, ...list];
  const copy = [...list];
  copy[index] = connection;
  return copy;
}
