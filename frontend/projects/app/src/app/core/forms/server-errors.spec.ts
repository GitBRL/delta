import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, Validators } from '@angular/forms';
import { clientErrorMessage, extractFieldErrors, validationMessage } from './server-errors';

describe('server-errors', () => {
  const unprocessable = new HttpErrorResponse({
    status: 422,
    error: {
      message: 'Os dados fornecidos são inválidos.',
      errors: { email: ['Este e-mail já está em uso.', 'outra'], name: ['Obrigatório.'] },
    },
  });

  it('extrai a primeira mensagem de cada campo de um 422', () => {
    expect(extractFieldErrors(unprocessable)).toEqual({ email: 'Este e-mail já está em uso.', name: 'Obrigatório.' });
    expect(validationMessage(unprocessable)).toBe('Os dados fornecidos são inválidos.');
  });

  it('retorna null para erros que não são 422', () => {
    expect(extractFieldErrors(new HttpErrorResponse({ status: 500 }))).toBeNull();
    expect(extractFieldErrors(new Error('x'))).toBeNull();
  });

  it('mensagens de cliente só aparecem depois de interação', () => {
    const control = new FormControl('', Validators.required);
    expect(clientErrorMessage(control, 'seu nome')).toBeNull();
    control.markAsTouched();
    expect(clientErrorMessage(control, 'seu nome')).toBe('Informe seu nome.');
  });
});
