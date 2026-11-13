/** Estados do semáforo de atenção (ver §7.2 do planejamento). */
export type StatusLevel = 'healthy' | 'attention' | 'critical' | 'opportunity';

export interface StatusMeta {
  level: StatusLevel;
  label: string;
  emoji: string;
  /** Variável CSS da cor do estado. */
  colorVar: string;
  /** Estados que pedem ação pulsam suavemente. */
  pulses: boolean;
}

const META: Record<StatusLevel, StatusMeta> = {
  healthy: {
    level: 'healthy',
    label: 'Saudável',
    emoji: '🟢',
    colorVar: '--ds-status-healthy',
    pulses: false,
  },
  attention: {
    level: 'attention',
    label: 'Atenção',
    emoji: '🟡',
    colorVar: '--ds-status-attention',
    pulses: true,
  },
  critical: {
    level: 'critical',
    label: 'Crítico',
    emoji: '🔴',
    colorVar: '--ds-status-critical',
    pulses: true,
  },
  opportunity: {
    level: 'opportunity',
    label: 'Oportunidade',
    emoji: '🔵',
    colorVar: '--ds-status-opportunity',
    pulses: false,
  },
};

export const STATUS_LEVELS: readonly StatusLevel[] = ['healthy', 'attention', 'critical', 'opportunity'];

export function statusMeta(level: StatusLevel): StatusMeta {
  return META[level];
}
