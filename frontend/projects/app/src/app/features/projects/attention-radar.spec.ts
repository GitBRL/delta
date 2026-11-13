import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AttentionResult, AttentionSignal } from '../../core/api/api.types';
import { AttentionRadar } from './attention-radar';

const signal = (rule: string, metric: string, status: AttentionSignal['status'], title = rule): AttentionSignal => ({
  rule,
  metric,
  status,
  title,
  explanation: `Explicação de ${rule}`,
  suggestion: `Sugestão de ${rule}`,
  evidence: {},
});

const result = (signals: AttentionSignal[], summary = { critical: 0, attention: 0, opportunity: 0 }): AttentionResult => ({
  period: { start: '2026-10-13', end: '2026-11-11' },
  summary,
  statuses: {},
  signals,
});

describe('AttentionRadar', () => {
  let fixture: ComponentFixture<AttentionRadar>;
  let el: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(AttentionRadar);
    el = fixture.nativeElement as HTMLElement;
  });

  it('mostra resumo e cards na ordem de urgência, com o porquê e o que fazer', async () => {
    fixture.componentRef.setInput(
      'result',
      result(
        [
          signal('oportunidade', 'google_ads:search_impression_share', 'opportunity'),
          signal('cpa', 'meta_ads:cpa', 'critical', 'CPA acima da meta'),
          signal('freq', 'meta_ads:frequency', 'attention'),
        ],
        { critical: 1, attention: 1, opportunity: 1 },
      ),
    );
    await fixture.whenStable();

    expect([...el.querySelectorAll('.summary-chip')].map((c) => c.textContent?.trim())).toEqual([
      '1 crítico',
      '1 em atenção',
      '1 oportunidade',
    ]);
    const cards = [...el.querySelectorAll('article.signal')];
    expect(cards.map((c) => c.getAttribute('data-status'))).toEqual(['critical', 'attention', 'opportunity']);
    expect(cards[0].querySelector('h3')?.textContent).toContain('CPA acima da meta');
    expect(cards[0].querySelector('ds-status-badge')?.getAttribute('data-status')).toBe('critical');
    expect(cards[0].textContent).toContain('Explicação de cpa');
    expect(cards[0].querySelector('.todo')?.textContent).toContain('O que fazer');
    expect(cards[0].querySelector('.todo')?.textContent).toContain('Sugestão de cpa');
  });

  it('só deixa clicar nos sinais de métricas presentes na grade', async () => {
    const picked: string[] = [];
    fixture.componentInstance.metricSelect.subscribe((m) => picked.push(m));
    fixture.componentRef.setInput(
      'result',
      result([signal('cpa', 'meta_ads:cpa', 'critical'), signal('freq', 'meta_ads:frequency', 'attention')]),
    );
    fixture.componentRef.setInput('selectableMetrics', ['meta_ads:spend', 'meta_ads:cpa']);
    await fixture.whenStable();

    const [cpa, freq] = [...el.querySelectorAll<HTMLElement>('article.signal')];
    expect(cpa.getAttribute('role')).toBe('button');
    expect(freq.getAttribute('role')).toBeNull();
    expect(cpa.textContent).toContain('Ver no gráfico');

    freq.click();
    cpa.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(picked).toEqual(['meta_ads:cpa']);

    fixture.componentRef.setInput('selectedMetric', 'meta_ads:cpa');
    await fixture.whenStable();
    expect(cpa.getAttribute('aria-pressed')).toBe('true');
  });

  it('comemora quando nada disparou', async () => {
    fixture.componentRef.setInput('result', result([]));
    await fixture.whenStable();

    expect(el.querySelector('.healthy')?.textContent).toContain('Tudo saudável neste período');
    expect(el.querySelector('.healthy ds-status-badge')?.getAttribute('data-status')).toBe('healthy');
    expect(el.querySelectorAll('.summary-chip').length).toBe(0);
  });

  it('mostra esqueleto enquanto carrega e erro com "tentar de novo"', async () => {
    fixture.componentRef.setInput('loading', true);
    await fixture.whenStable();
    expect(el.querySelector('.signals')?.getAttribute('aria-busy')).toBe('true');
    expect(el.querySelectorAll('ds-skeleton').length).toBeGreaterThan(0);

    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => retried++);
    fixture.componentRef.setInput('error', 'Não foi possível avaliar o radar de atenção.');
    await fixture.whenStable();

    expect(el.querySelector('[role=alert]')?.textContent).toContain('Não foi possível avaliar');
    el.querySelector<HTMLButtonElement>('[role=alert] button')!.click();
    expect(retried).toBe(1);
  });
});
