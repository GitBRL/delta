import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

let nextId = 0;

/**
 * Campo de texto com rótulo, dica e erro. Funciona com Reactive Forms (formControlName).
 * O erro é decisão de quem usa: passe a mensagem já resolvida em `error`.
 */
@Component({
  selector: 'ds-text-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DsTextField), multi: true },
  ],
  host: {
    class: 'ds-text-field',
    '[class.has-error]': '!!error()',
    '[class.is-disabled]': 'disabled()',
  },
  template: `
    <label class="field">
      <span class="label">{{ label() }}</span>
      <input
        class="input"
        [id]="inputId"
        [type]="type()"
        [attr.name]="name() || null"
        [attr.autocomplete]="autocomplete() || null"
        [attr.inputmode]="inputmode() || null"
        [attr.maxlength]="maxlength() || null"
        [placeholder]="placeholder()"
        [value]="value()"
        [disabled]="disabled()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-describedby]="error() ? errorId : hint() ? hintId : null"
        (input)="onInput($event)"
        (blur)="onTouched()"
      />
    </label>
    @if (error()) {
      <span class="message error" [id]="errorId" role="alert" animate.enter="ds-enter-fade-up">{{
        error()
      }}</span>
    } @else if (hint()) {
      <span class="message hint" [id]="hintId">{{ hint() }}</span>
    }
  `,
  styleUrl: './text-field.css',
})
export class DsTextField implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly type = input<'text' | 'email' | 'password' | 'search' | 'tel' | 'url' | 'number'>(
    'text',
  );
  readonly name = input<string>();
  readonly autocomplete = input<string>();
  readonly inputmode = input<string>();
  readonly maxlength = input<number>();
  readonly placeholder = input('');
  readonly hint = input<string>();
  readonly error = input<string | null>();

  protected readonly value = signal('');
  protected readonly disabled = signal(false);

  private readonly uid = `ds-tf-${nextId++}`;
  protected readonly inputId = `${this.uid}-input`;
  protected readonly errorId = `${this.uid}-error`;
  protected readonly hintId = `${this.uid}-hint`;

  private onChange: (value: string) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  writeValue(value: unknown): void {
    this.value.set(value == null ? '' : String(value));
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected onInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value;
    this.value.set(next);
    this.onChange(next);
  }
}
