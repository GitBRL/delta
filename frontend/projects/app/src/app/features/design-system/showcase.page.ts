import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ChartPoint,
  DsAreaChart,
  DsButton,
  DsGlassCard,
  DsHealthRings,
  DsKpiTile,
  DsSkeleton,
  DsStatusBadge,
  DsTextField,
  DsThemeService,
  DsThemeToggle,
  DsToastService,
  STATUS_LEVELS,
  metricFormatter,
} from 'design-system';
import { DeltaLogo } from '../auth/delta-logo';

/**
 * Vitrine do design system (substitui o Storybook por enquanto).
 * Rota pública: /design-system
 */
@Component({
  selector: 'app-design-system-showcase',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DeltaLogo,
    DsAreaChart,
    DsButton,
    DsGlassCard,
    DsHealthRings,
    DsKpiTile,
    DsSkeleton,
    DsStatusBadge,
    DsTextField,
    DsThemeToggle,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './showcase.page.html',
  styleUrl: './showcase.page.css',
})
export class DesignSystemShowcasePage {
  protected readonly toast = inject(DsToastService);
  protected readonly theme = inject(DsThemeService);

  protected readonly statuses = STATUS_LEVELS;

  /** Série de exemplo para o gráfico de área (30 dias, com um dia sem dados). */
  protected readonly chartSeries = signal<ChartPoint[]>(demoSeries(30, '2026-10', 1));
  protected readonly chartPrevious = demoSeries(30, '2026-09', 0.82);
  protected readonly currency = metricFormatter('currency', 2);

  protected regenerateChart(): void {
    this.chartSeries.set(demoSeries(30, '2026-10', 0.8 + Math.random() * 0.5));
  }

  protected readonly colorTokens = [
    { name: '--ds-bg', label: 'Fundo' },
    { name: '--ds-bg-elevated', label: 'Elevado' },
    { name: '--ds-text', label: 'Texto' },
    { name: '--ds-text-secondary', label: 'Texto secundário' },
    { name: '--ds-fill', label: 'Preenchimento' },
    { name: '--ds-accent', label: 'Destaque' },
    { name: '--ds-status-healthy', label: 'Saudável' },
    { name: '--ds-status-attention', label: 'Atenção' },
    { name: '--ds-status-critical', label: 'Crítico' },
    { name: '--ds-status-opportunity', label: 'Oportunidade' },
    { name: '--ds-ring-acquisition', label: 'Aquisição' },
    { name: '--ds-ring-engagement', label: 'Engajamento' },
    { name: '--ds-ring-conversion', label: 'Conversão' },
  ];

  protected readonly typeScale = [
    { token: '--ds-text-large-title', label: 'Large Title 34' },
    { token: '--ds-text-title-1', label: 'Title 1 28' },
    { token: '--ds-text-title-2', label: 'Title 2 22' },
    { token: '--ds-text-title-3', label: 'Title 3 20' },
    { token: '--ds-text-headline', label: 'Headline 17' },
    { token: '--ds-text-body', label: 'Body 17' },
    { token: '--ds-text-callout', label: 'Callout 16' },
    { token: '--ds-text-subhead', label: 'Subhead 15' },
    { token: '--ds-text-footnote', label: 'Footnote 13' },
    { token: '--ds-text-caption', label: 'Caption 12' },
  ];

  protected readonly accents = [
    { label: 'Padrão', value: null },
    { label: 'Violeta', value: 'oklch(0.56 0.22 295)' },
    { label: 'Esmeralda', value: 'oklch(0.6 0.15 160)' },
    { label: 'Coral', value: 'oklch(0.64 0.19 30)' },
  ];

  protected readonly loadingDemo = signal(false);
  protected readonly rings = signal({ acquisition: 82, engagement: 64, conversion: 47 });
  protected readonly ringsKey = signal(0);
  protected readonly kpiValue = signal(48_240);

  protected readonly email = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email],
  });

  protected emailError(): string | null {
    const c = this.email;
    if (!(c.touched || c.dirty) || !c.errors) return null;
    return c.errors['required'] ? 'Informe seu e-mail.' : 'E-mail inválido.';
  }

  protected simulateLoading(): void {
    this.loadingDemo.set(true);
    setTimeout(() => this.loadingDemo.set(false), 1800);
  }

  protected randomizeRings(): void {
    const r = () => Math.round(20 + Math.random() * 80);
    this.rings.set({ acquisition: r(), engagement: r(), conversion: r() });
    // Recria o componente para reproduzir a animação de entrada.
    this.ringsKey.update((k) => k + 1);
  }

  protected randomizeKpi(): void {
    this.kpiValue.set(Math.round(10_000 + Math.random() * 90_000));
  }
}

function demoSeries(days: number, month: string, factor: number): ChartPoint[] {
  return Array.from({ length: days }, (_, i) => ({
    date: `${month}-${String(i + 1).padStart(2, '0')}`,
    value:
      i === 17 && factor === 1
        ? null
        : Math.round((900 + Math.sin(i / 3) * 280 + i * 22) * factor * 100) / 100,
  }));
}
