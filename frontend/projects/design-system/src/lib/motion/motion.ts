/** Verdadeiro quando o usuário pediu movimento reduzido (ou o ambiente não suporta matchMedia). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Desaceleração exponencial: começa rápido, assenta suave. */
export function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * Anima um número de `from` até `to` chamando `onUpdate` a cada frame.
 * Sem requestAnimationFrame ou com movimento reduzido, entrega o valor final na hora.
 * @returns função que cancela a animação.
 */
export function animateNumber(
  from: number,
  to: number,
  durationMs: number,
  onUpdate: (value: number) => void,
): () => void {
  if (
    from === to ||
    durationMs <= 0 ||
    typeof requestAnimationFrame !== 'function' ||
    prefersReducedMotion()
  ) {
    onUpdate(to);
    return () => undefined;
  }

  let frame = 0;
  let start: number | null = null;

  const step = (now: number) => {
    start ??= now;
    const progress = Math.min((now - start) / durationMs, 1);
    onUpdate(from + (to - from) * easeOutExpo(progress));
    if (progress < 1) {
      frame = requestAnimationFrame(step);
    }
  };

  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
