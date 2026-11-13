import { relativeTime } from './relative-time';

const NOW = new Date('2026-11-12T15:00:00Z');

describe('relativeTime', () => {
  it('descreve instantes recentes em português', () => {
    expect(relativeTime('2026-11-12T14:59:50Z', NOW)).toBe('agora');
    expect(relativeTime('2026-11-12T14:55:00Z', NOW)).toBe('há 5 minutos');
    expect(relativeTime('2026-11-12T12:00:00Z', NOW)).toBe('há 3 horas');
    expect(relativeTime('2026-11-11T15:00:00Z', NOW)).toBe('ontem');
  });

  it('trata ausência e valores inválidos', () => {
    expect(relativeTime(null, NOW)).toBe('nunca');
    expect(relativeTime('não é data', NOW)).toBe('—');
  });
});
