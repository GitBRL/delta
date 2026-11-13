import { EffectRef, Injector, effect } from '@angular/core';

/**
 * Executa `action` a cada `intervalMs` enquanto `condition()` (sinal) for verdadeira.
 * Para sozinho quando a condição vira falsa e quando o contexto de injeção (ex.: a tela) é destruído.
 *
 * Usa setInterval (e não um setTimeout rearmado) porque, entre um ciclo e outro, a condição pode
 * continuar `true` sem mudar de valor, e um efeito não roda de novo sem mudança.
 */
export function pollWhile(
  condition: () => boolean,
  action: () => void,
  intervalMs = 3000,
  options: { injector?: Injector } = {},
): EffectRef {
  return effect(
    (onCleanup) => {
      if (!condition()) {
        return;
      }
      const id = setInterval(action, intervalMs);
      onCleanup(() => clearInterval(id));
    },
    { injector: options.injector },
  );
}
