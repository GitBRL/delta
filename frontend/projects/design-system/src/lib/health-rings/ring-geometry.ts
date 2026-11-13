/**
 * Geometria dos anéis animados só com `transform: rotate`.
 *
 * Cada anel é desenhado por dois semicírculos, cada um recortado por uma metade do círculo:
 *  - peça A (recorte direito): gira de 0° a `a` e revela o arco de 0° até `a` (máx. 180°);
 *  - peça B (recorte esquerdo): gira de 0° a `b` e revela de 180° até 180°+`b`.
 * Assim o anel "se completa" animando apenas rotação — sem stroke-dashoffset.
 */
export interface RingAngles {
  /** Rotação da peça A, em graus (0–180). */
  a: number;
  /** Rotação da peça B, em graus (0–180). */
  b: number;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

export function ringAngles(percent: number): RingAngles {
  const theta = clampPercent(percent) * 3.6;
  return { a: Math.min(theta, 180), b: Math.max(theta - 180, 0) };
}

/** Semicírculo esquerdo (do topo à base, passando pela esquerda) num viewBox 100×100. */
export function leftHalfPath(r: number): string {
  return `M 50 ${50 - r} A ${r} ${r} 0 0 0 50 ${50 + r}`;
}

/** Semicírculo direito (do topo à base, passando pela direita) num viewBox 100×100. */
export function rightHalfPath(r: number): string {
  return `M 50 ${50 - r} A ${r} ${r} 0 0 1 50 ${50 + r}`;
}
