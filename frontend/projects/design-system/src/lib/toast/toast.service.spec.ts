import { TestBed } from '@angular/core/testing';
import { DsToastService } from './toast.service';

describe('DsToastService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('mostra e remove sozinho após o tempo', () => {
    const service = TestBed.inject(DsToastService);
    service.success('Salvo', { timeout: 1000 });
    expect(service.toasts().map((t) => t.title)).toEqual(['Salvo']);

    vi.advanceTimersByTime(1000);
    expect(service.toasts()).toEqual([]);
  });

  it('mantém no máximo 4 notificações visíveis', () => {
    const service = TestBed.inject(DsToastService);
    for (let i = 1; i <= 6; i++) {
      service.info(`n${i}`, { timeout: 0 });
    }
    expect(service.toasts().map((t) => t.title)).toEqual(['n3', 'n4', 'n5', 'n6']);
  });

  it('dismiss remove pelo id', () => {
    const service = TestBed.inject(DsToastService);
    const id = service.error('Falhou', { timeout: 0 });
    service.dismiss(id);
    expect(service.toasts()).toEqual([]);
  });
});
