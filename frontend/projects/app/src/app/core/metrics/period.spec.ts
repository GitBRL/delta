import { formatRange, lastAvailableDay, rangeDays, resolvePreset, toIsoDate, validateRange } from './period';

// Datas locais fixas: 12/11/2026 (quinta-feira) e alguns casos de borda.
const TODAY = new Date(2026, 10, 12);

describe('períodos', () => {
  it('termina sempre em ontem', () => {
    expect(toIsoDate(lastAvailableDay(TODAY))).toBe('2026-11-11');
    expect(resolvePreset('last_7', TODAY)).toEqual({ start: '2026-11-05', end: '2026-11-11' });
    expect(resolvePreset('last_14', TODAY)).toEqual({ start: '2026-10-29', end: '2026-11-11' });
    expect(resolvePreset('last_30', TODAY)).toEqual({ start: '2026-10-13', end: '2026-11-11' });
  });

  it('"Mês passado" cobre o mês anterior inteiro, inclusive na virada do ano', () => {
    expect(resolvePreset('last_month', TODAY)).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(resolvePreset('last_month', new Date(2027, 0, 15))).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(resolvePreset('last_month', new Date(2028, 2, 3))).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('"Este mês" vai do dia 1 até ontem e não existe no dia 1', () => {
    expect(resolvePreset('this_month', TODAY)).toEqual({ start: '2026-11-01', end: '2026-11-11' });
    expect(resolvePreset('this_month', new Date(2026, 10, 2))).toEqual({ start: '2026-11-01', end: '2026-11-01' });
    expect(resolvePreset('this_month', new Date(2026, 10, 1))).toBeNull();
  });

  it('"Personalizado" não tem intervalo próprio', () => {
    expect(resolvePreset('custom', TODAY)).toBeNull();
  });

  it('conta os dias incluindo as duas pontas', () => {
    expect(rangeDays({ start: '2026-11-05', end: '2026-11-11' })).toBe(7);
    expect(rangeDays({ start: '2026-11-11', end: '2026-11-11' })).toBe(1);
  });

  it('valida intervalos personalizados com as regras do backend', () => {
    expect(validateRange({ start: '2026-11-01', end: '2026-11-11' }, TODAY)).toBeNull();
    expect(validateRange({ start: '2026-11-10', end: '2026-11-01' }, TODAY)).toContain('posterior');
    expect(validateRange({ start: '2026-11-01', end: '2026-11-12' }, TODAY)).toContain('até ontem');
    expect(validateRange({ start: '2025-01-01', end: '2026-11-11' }, TODAY)).toContain('400 dias');
    expect(validateRange({ start: '2026-02-31', end: '2026-11-11' }, TODAY)).toContain('duas datas');
  });

  it('formata o intervalo para exibição', () => {
    expect(formatRange({ start: '2026-11-05', end: '2026-11-11' })).toBe('05/11/2026 – 11/11/2026');
    expect(formatRange({ start: '2026-11-11', end: '2026-11-11' })).toBe('11/11/2026');
  });
});
