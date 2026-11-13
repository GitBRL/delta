import { CanDeactivateFn } from '@angular/router';

export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

export const UNSAVED_MESSAGE = 'Há alterações não salvas neste relatório. Sair mesmo assim?';

/** Pergunta antes de sair de uma tela com alterações não salvas. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) =>
  !component?.hasUnsavedChanges() || (typeof confirm === 'function' ? confirm(UNSAVED_MESSAGE) : true);
