import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from 'design-system';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { errorInterceptor } from '../http/interceptors';
import { TenantService } from '../tenant/tenant.service';
import { PlanLimitDialog } from './plan-limit-dialog';
import {
  PlanLimitService,
  daysUntil,
  isPlanLimitError,
  limitText,
  planLimitNotice,
  priceText,
  trialBanner,
  usagePct,
  usageText,
  usageTone,
} from './plan-limit';

const BODY = {
  message: 'O plano Essencial permite até 5 projetos (em uso: 5). Mude de plano em Configurações › Plano para continuar.',
  errors: { plan: ['O plano Essencial permite até 5 projetos.'] },
  plan_limit: { limit: 'projects', allowed: 5, used: 5 },
};

describe('helpers do plano', () => {
  it('lê o 402 do backend', () => {
    const error = new HttpErrorResponse({ status: 402, error: BODY });
    expect(isPlanLimitError(error)).toBe(true);
    expect(planLimitNotice(error)).toEqual({ message: BODY.message, limit: 'projects', allowed: 5, used: 5 });
    expect(planLimitNotice(new HttpErrorResponse({ status: 402, error: null }))?.message).toBe('Esta ação passa do que o plano da agência permite.');
    expect(planLimitNotice(new HttpErrorResponse({ status: 422, error: BODY }))).toBeNull();
  });

  it('formata limites, uso e preço', () => {
    expect(limitText('projects', null)).toBe('Sem limite');
    expect(limitText('whatsapp_messages', 2000)).toBe('2.000');
    expect(limitText('ai_tokens', 3_000_000).replace(/\s/g, ' ')).toBe('3 mi');
    expect(usageText('ai_tokens', 1_250_000).replace(/\s/g, ' ')).toBe('1,3 mi');
    expect(usagePct(50, 100)).toBe(50);
    expect(usagePct(150, 100)).toBe(100);
    expect(usagePct(3, null)).toBeNull();
    expect(usagePct(0, 0)).toBe(100);
    expect([usageTone(10), usageTone(85), usageTone(100), usageTone(null)]).toEqual(['ok', 'warn', 'full', 'ok']);
    expect(priceText(null)).toBe('Sob consulta');
    expect(priceText(390).replace(/\s/g, ' ')).toBe('R$ 390/mês');
  });

  it('decide o banner do teste grátis', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
    expect(daysUntil(at(2.5), now)).toBe(3);
    expect(trialBanner({ status: 'trialing', usable: true, trial_ends_at: at(10) }, now)).toBeNull();
    expect(trialBanner({ status: 'trialing', usable: true, trial_ends_at: at(3) }, now)).toEqual({ kind: 'ending', days: 3 });
    expect(trialBanner({ status: 'trialing', usable: false, trial_ends_at: at(-1) }, now)).toEqual({ kind: 'ended', status: 'trialing' });
    expect(trialBanner({ status: 'canceled', usable: false, trial_ends_at: null }, now)).toEqual({ kind: 'ended', status: 'canceled' });
    expect(trialBanner({ status: 'active', usable: true, trial_ends_at: null }, now)).toBeNull();
  });
});

describe('402 global', () => {
  it('o interceptor guarda o aviso do plano e não mexe nos 422', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: TenantService, useValue: { currentId: signal('t1') } },
        { provide: AuthService, useValue: { clear: vi.fn() } },
      ],
    });
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);
    const plan = TestBed.inject(PlanLimitService);
    const toast = vi.spyOn(TestBed.inject(DsToastService), 'error');

    const created = firstValueFrom(http.post('/api/projects', { name: 'Novo' })).catch((e: unknown) => e);
    backend.expectOne('/api/projects').flush(BODY, { status: 402, statusText: 'Payment Required' });
    expect(isPlanLimitError(await created)).toBe(true);
    expect(plan.notice()?.limit).toBe('projects');
    expect(toast).not.toHaveBeenCalled();

    plan.dismiss();
    const invalid = firstValueFrom(http.post('/api/projects', {})).catch((e: unknown) => e);
    backend.expectOne('/api/projects').flush({ message: 'x', errors: { name: ['Informe o nome.'] } }, { status: 422, statusText: 'Unprocessable' });
    await invalid;
    expect(plan.notice()).toBeNull();

    // Página pública não abre o diálogo.
    const pub = firstValueFrom(http.get('/api/public/approvals/abc')).catch((e: unknown) => e);
    backend.expectOne('/api/public/approvals/abc').flush(BODY, { status: 402, statusText: 'Payment Required' });
    await pub;
    expect(plan.notice()).toBeNull();
    backend.verify();
  });
});

describe('PlanLimitDialog', () => {
  it('mostra "Ver plano" só para quem pode ver a página', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(PlanLimitDialog);
    fixture.componentRef.setInput('notice', { message: 'Studio não faz parte do plano Essencial.', limit: 'studio', allowed: null, used: null });
    fixture.componentRef.setInput('canSeePlan', true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alertdialog"]')?.getAttribute('aria-describedby')).toBe('plan-limit-message');
    expect(el.textContent).toContain('Studio não faz parte do plano Essencial.');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/configuracoes/plano');
    expect(el.querySelector('[data-testid="plan-limit-usage"]')).toBeNull();

    const dismissed = vi.fn();
    fixture.componentInstance.dismissed.subscribe(dismissed);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dismissed).toHaveBeenCalled();
  });
});
