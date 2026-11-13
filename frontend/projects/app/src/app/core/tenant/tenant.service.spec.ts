import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Me } from '../api/api.types';
import { AuthService } from '../auth/auth.service';
import { TenantService } from './tenant.service';

const ME: Me = {
  id: 'u1',
  name: 'Ana',
  email: 'ana@x.com',
  two_factor_enabled: false,
  tenants: [
    { id: 't1', name: 'Agência Norte', slug: 'norte', role: 'owner' },
    { id: 't2', name: 'Agência Sul', slug: 'sul', role: 'admin' },
  ],
};

describe('TenantService', () => {
  const user = signal<Me | null>(ME);

  function setup(): TenantService {
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { user } }],
    });
    return TestBed.inject(TenantService);
  }

  beforeEach(() => {
    localStorage.clear();
    user.set(ME);
  });

  it('isAdmin vale para dono e administrador, não para analista ou cliente', () => {
    const service = setup();
    expect(service.isAdmin()).toBe(true); // owner
    service.select('t2');
    expect(service.isAdmin()).toBe(true); // admin
    user.set({ ...ME, tenants: [{ id: 't3', name: 'Agência Leste', slug: 'leste', role: 'analyst' }] });
    expect(service.isAdmin()).toBe(false);
    user.set({ ...ME, tenants: [{ id: 't4', name: 'Cliente', slug: 'cliente', role: 'client' }] });
    expect(service.isAdmin()).toBe(false);
  });

  it('sem preferência salva, usa a primeira agência', () => {
    expect(setup().currentId()).toBe('t1');
  });

  it('respeita a preferência salva quando o usuário ainda pertence à agência', () => {
    localStorage.setItem('delta.tenant', 't2');
    expect(setup().currentId()).toBe('t2');
  });

  it('ignora preferência de agência que não está na lista', () => {
    localStorage.setItem('delta.tenant', 'tenant-de-outra-conta');
    expect(setup().currentId()).toBe('t1');
  });

  it('select persiste e só aceita agências do usuário', () => {
    const service = setup();
    service.select('t2');
    expect(service.currentId()).toBe('t2');
    expect(localStorage.getItem('delta.tenant')).toBe('t2');

    service.select('invasora');
    expect(service.currentId()).toBe('t2');
  });

  it('sem usuário, não há agência', () => {
    user.set(null);
    expect(setup().current()).toBeNull();
  });
});
