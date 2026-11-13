import { CanDeactivateFn } from '@angular/router';
import { HasUnsavedChanges } from '../../core/reports/unsaved-changes.guard';

export const UNSAVED_POST_MESSAGE = 'Há alterações não salvas neste post. Sair mesmo assim?';

/**
 * Pergunta antes de sair do editor de post com alterações não salvas. Arquivo próprio para a
 * rota não carregar o editor (lazy) no bundle inicial.
 */
export const unsavedPostGuard: CanDeactivateFn<HasUnsavedChanges> = (component) =>
  !component?.hasUnsavedChanges() || (typeof confirm === 'function' ? confirm(UNSAVED_POST_MESSAGE) : true);
