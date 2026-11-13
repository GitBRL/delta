import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { pollWhile } from './poll-while';

describe('pollWhile', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('repete enquanto a condição é verdadeira e para quando ela vira falsa', () => {
    const syncing = signal(true);
    const action = vi.fn();
    pollWhile(syncing, action, 3000, { injector: TestBed.inject(Injector) });
    TestBed.tick();

    vi.advanceTimersByTime(2999);
    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(action).toHaveBeenCalledTimes(2);

    syncing.set(false);
    TestBed.tick();
    vi.advanceTimersByTime(30_000);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('não começa quando a condição já é falsa e volta quando ela muda', () => {
    const syncing = signal(false);
    const action = vi.fn();
    pollWhile(syncing, action, 1000, { injector: TestBed.inject(Injector) });
    TestBed.tick();

    vi.advanceTimersByTime(5000);
    expect(action).not.toHaveBeenCalled();

    syncing.set(true);
    TestBed.tick();
    vi.advanceTimersByTime(1000);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('para quando é destruído (ex.: ao sair da tela)', () => {
    const action = vi.fn();
    const ref = pollWhile(() => true, action, 1000, { injector: TestBed.inject(Injector) });
    TestBed.tick();

    vi.advanceTimersByTime(1000);
    ref.destroy();
    vi.advanceTimersByTime(5000);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
