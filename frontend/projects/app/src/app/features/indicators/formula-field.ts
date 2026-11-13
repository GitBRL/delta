import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import {
  FORMULA_FUNCTIONS,
  FORMULA_MAX_LENGTH,
  FormulaOption,
  completionFor,
  formulaHints,
  insertAtCursor,
  replaceRange,
  suggestFormulaOptions,
  tokenizeFormula,
  wordAt,
} from '../../core/metrics/formula';

let nextId = 0;

const OPERATORS = [
  { text: '+', display: '+', label: 'Somar' },
  { text: '-', display: '−', label: 'Subtrair' },
  { text: '*', display: '×', label: 'Multiplicar' },
  { text: '/', display: '÷', label: 'Dividir' },
] as const;

type InsertKind = 'ref' | 'operator' | 'function' | 'paren' | 'comma';

/**
 * Campo de fórmula: texto com realce de tokens, autocompletar (métricas por plataforma,
 * indicadores e funções) e chips que inserem no cursor.
 *
 * O realce é uma camada <pre> por baixo de um <textarea> transparente, com a mesma tipografia:
 * o texto continua sendo um campo nativo (seleção, desfazer, leitor de tela).
 */
@Component({
  selector: 'app-formula-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <label class="label" [for]="inputId">{{ label() }}</label>

    <div class="editor" [class.invalid]="!!error()" [class.readonly]="readonly()">
      <pre class="highlight" aria-hidden="true" #highlight><code>@for (t of tokens(); track $index) {<span [class]="'tok tok-' + t.type + (t.known === false ? ' bad' : '')">{{ t.text }}</span>}{{ '\\n' }}</code></pre>
      <textarea
        #area
        class="input"
        rows="3"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        [id]="inputId"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="open() ? optionId(active()) : null"
        [attr.aria-invalid]="!!error()"
        [attr.aria-describedby]="metaId"
        [attr.maxlength]="maxLength + 100"
        [readOnly]="readonly()"
        [placeholder]="placeholder()"
        [value]="value()"
        (input)="onInput()"
        (keydown)="onKeydown($event)"
        (click)="refreshSuggestions()"
        (keyup)="onKeyup($event)"
        (blur)="close()"
        (scroll)="syncScroll()"
      ></textarea>

      @if (open()) {
        <ul class="suggestions" role="listbox" [id]="listId" aria-label="Sugestões">
          @for (s of suggestions(); track s.key) {
            <li
              role="option"
              class="suggestion"
              [id]="optionId($index)"
              [attr.aria-selected]="$index === active()"
              (mousedown)="$event.preventDefault(); accept(s)"
            >
              <span class="s-label">{{ s.label }}</span>
              @if (s.kind !== 'function') {
                <code class="s-key">{{ s.key }}</code>
              }
              <span class="s-group">{{ s.group }}</span>
            </li>
          }
        </ul>
      }
    </div>

    <div class="meta" [id]="metaId">
      <div class="messages">
        @if (error()) {
          <p class="server-error" role="alert">{{ error() }}</p>
        }
        @for (h of hints(); track h) {
          <p class="hint">{{ h }}</p>
        }
      </div>
      <span class="count" [class.over]="value().length > maxLength">{{ value().length }}/{{ maxLength }}</span>
    </div>

    @if (!readonly()) {
      <div class="toolbar" role="toolbar" aria-label="Inserir na fórmula">
        @for (op of operators; track op.text) {
          <button
            type="button"
            class="tool op"
            [attr.aria-label]="op.label"
            [title]="op.label"
            (mousedown)="$event.preventDefault()"
            (click)="insert('operator', op.text)"
          >
            {{ op.display }}
          </button>
        }
        <button type="button" class="tool op" aria-label="Abrir parêntese" (mousedown)="$event.preventDefault()" (click)="insert('paren', '(')">(</button>
        <button type="button" class="tool op" aria-label="Fechar parêntese" (mousedown)="$event.preventDefault()" (click)="insert('paren', ')')">)</button>
        <button type="button" class="tool op" aria-label="Vírgula" (mousedown)="$event.preventDefault()" (click)="insert('comma', ',')">,</button>
        <span class="divider" aria-hidden="true"></span>
        @for (fn of functions; track fn.name) {
          <button
            type="button"
            class="tool fn"
            [title]="fn.signature + ' — ' + fn.description"
            (mousedown)="$event.preventDefault()"
            (click)="insert('function', fn.name)"
          >
            {{ fn.name }}()
          </button>
        }
      </div>

      @if (groups().length) {
        <div class="palette">
          <div class="tabs" role="tablist" aria-label="Métricas por plataforma">
            @for (g of groups(); track g) {
              <button
                type="button"
                role="tab"
                class="tab"
                [attr.aria-selected]="g === activeGroup()"
                (mousedown)="$event.preventDefault()"
                (click)="chosenGroup.set(g)"
              >
                {{ g }}
              </button>
            }
          </div>
          <div class="chips" role="tabpanel" [attr.aria-label]="activeGroup()">
            @for (o of groupOptions(); track o.key) {
              <button
                type="button"
                class="chip"
                [title]="o.key + (o.detail ? ' — ' + o.detail : '')"
                (mousedown)="$event.preventDefault()"
                (click)="insert('ref', o.key)"
              >
                {{ o.label }}
              </button>
            }
          </div>
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
    }
    .label {
      font: var(--ds-text-footnote);
      font-weight: 600;
      color: var(--ds-text-secondary);
    }
    .editor {
      position: relative;
      border: 1px solid var(--ds-separator);
      border-radius: var(--ds-radius-md);
      background: var(--ds-bg-elevated);
      transition: border-color var(--ds-duration-fast) var(--ds-ease-out), box-shadow var(--ds-duration-fast) var(--ds-ease-out);
    }
    .editor:focus-within {
      border-color: var(--ds-accent);
      box-shadow: 0 0 0 4px var(--ds-focus-ring);
    }
    .editor.invalid {
      border-color: var(--ds-status-critical);
    }
    .highlight,
    .input {
      margin: 0;
      padding: 12px 14px;
      min-height: 84px;
      font-family: var(--ds-font-mono, ui-monospace, 'SF Mono', Menlo, Consolas, monospace);
      font-size: 14px;
      line-height: 1.6;
      letter-spacing: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      tab-size: 2;
    }
    .highlight {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      color: var(--ds-text);
    }
    .input {
      position: relative;
      display: block;
      width: 100%;
      box-sizing: border-box;
      resize: vertical;
      border: 0;
      outline: none;
      background: transparent;
      color: transparent;
      caret-color: var(--ds-text);
    }
    .input::placeholder {
      color: var(--ds-text-tertiary);
    }
    .input::selection {
      background: var(--ds-accent-soft);
      color: transparent;
    }
    .tok-ref {
      color: var(--ds-accent);
      font-weight: 600;
    }
    .tok-function {
      color: var(--ds-ring-acquisition);
      font-weight: 600;
    }
    .tok-number {
      color: var(--ds-ring-engagement);
    }
    .tok-operator,
    .tok-paren,
    .tok-comma {
      color: var(--ds-text-secondary);
    }
    .bad,
    .tok-unknown {
      color: var(--ds-status-critical);
      text-decoration: underline wavy var(--ds-status-critical);
      text-underline-offset: 3px;
    }
    .suggestions {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      z-index: 20;
      max-height: 280px;
      margin: 0;
      padding: 6px;
      overflow: auto;
      list-style: none;
      border: 1px solid var(--ds-glass-border);
      border-radius: var(--ds-radius-md);
      background: var(--ds-glass-bg-strong);
      backdrop-filter: var(--ds-glass-filter);
      box-shadow: var(--ds-shadow-3, 0 12px 32px rgb(0 0 0 / 0.18));
      animation: ds-fade-up var(--ds-duration-base) var(--ds-ease-spring-gentle) both;
    }
    .suggestion {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-areas: 'label group' 'key group';
      column-gap: 12px;
      padding: 6px 10px;
      border-radius: var(--ds-radius-sm);
      cursor: pointer;
    }
    .suggestion[aria-selected='true'] {
      background: var(--ds-accent-soft);
    }
    .s-label {
      grid-area: label;
      font: var(--ds-text-footnote);
      font-weight: 600;
      color: var(--ds-text);
    }
    .s-key {
      grid-area: key;
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
    }
    .s-group {
      grid-area: group;
      align-self: center;
      font: var(--ds-text-caption);
      color: var(--ds-text-secondary);
    }
    .meta {
      display: flex;
      justify-content: space-between;
      gap: var(--ds-space-3);
    }
    .messages {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .messages p {
      margin: 0;
      font: var(--ds-text-footnote);
    }
    .server-error {
      color: var(--ds-status-critical);
      font-weight: 600;
    }
    .hint {
      color: var(--ds-status-attention);
    }
    .count {
      flex: none;
      font: var(--ds-text-caption);
      color: var(--ds-text-tertiary);
      font-variant-numeric: tabular-nums;
    }
    .count.over {
      color: var(--ds-status-critical);
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .divider {
      width: 1px;
      height: 20px;
      margin: 0 4px;
      background: var(--ds-separator);
    }
    .tool,
    .chip,
    .tab {
      border: 0;
      cursor: pointer;
      font: var(--ds-text-footnote);
      font-weight: 600;
      transition: transform var(--ds-duration-base) var(--ds-ease-spring), background-color var(--ds-duration-fast) var(--ds-ease-out);
    }
    .tool:active,
    .chip:active {
      transform: scale(0.92);
    }
    .tool {
      min-width: 32px;
      height: 30px;
      padding: 0 10px;
      border-radius: var(--ds-radius-sm);
      background: var(--ds-fill);
      color: var(--ds-text);
    }
    .tool.fn {
      color: var(--ds-ring-acquisition);
      font-family: var(--ds-font-mono, ui-monospace, monospace);
    }
    .tool:hover,
    .chip:hover {
      background: var(--ds-fill-strong);
    }
    .palette {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-2);
      padding: var(--ds-space-3);
      border-radius: var(--ds-radius-md);
      background: var(--ds-fill);
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 2px;
    }
    .tab {
      padding: 4px 10px;
      border-radius: var(--ds-radius-sm);
      background: transparent;
      color: var(--ds-text-secondary);
    }
    .tab[aria-selected='true'] {
      background: var(--ds-bg-elevated);
      color: var(--ds-text);
      box-shadow: var(--ds-shadow-1);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip {
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--ds-accent-soft);
      color: var(--ds-accent);
    }
  `,
})
export class FormulaField {
  readonly value = model('');
  readonly options = input<readonly FormulaOption[]>([]);
  readonly readonly = input(false);
  /** Mensagem do backend (422) para a fórmula atual. */
  readonly error = input<string | null>(null);
  readonly label = input('Fórmula');
  readonly placeholder = input('Ex.: sum(meta_ads:conversion_value, google_ads:conversion_value) / sum(meta_ads:spend, google_ads:cost)');

  private readonly injector = inject(Injector);
  private readonly area = viewChild.required<ElementRef<HTMLTextAreaElement>>('area');
  private readonly highlight = viewChild<ElementRef<HTMLPreElement>>('highlight');

  protected readonly maxLength = FORMULA_MAX_LENGTH;
  protected readonly operators = OPERATORS;
  protected readonly functions = FORMULA_FUNCTIONS;
  private readonly uid = `formula-${nextId++}`;
  protected readonly inputId = `${this.uid}-input`;
  protected readonly listId = `${this.uid}-list`;
  protected readonly metaId = `${this.uid}-meta`;

  private readonly knownKeys = computed(
    () => new Set(this.options().filter((o) => o.kind !== 'function').map((o) => o.key)),
  );
  protected readonly tokens = computed(() => tokenizeFormula(this.value(), this.knownKeys()));
  protected readonly hints = computed(() => formulaHints(this.value(), this.knownKeys()));

  /* ---------- Paleta de métricas por grupo ---------- */
  protected readonly groups = computed(() => [
    ...new Set(this.options().filter((o) => o.kind !== 'function').map((o) => o.group)),
  ]);
  protected readonly chosenGroup = signal<string | null>(null);
  protected readonly activeGroup = computed(() => {
    const chosen = this.chosenGroup();
    const groups = this.groups();
    return chosen && groups.includes(chosen) ? chosen : (groups[0] ?? '');
  });
  protected readonly groupOptions = computed(() =>
    this.options().filter((o) => o.kind !== 'function' && o.group === this.activeGroup()),
  );

  /* ---------- Autocompletar ---------- */
  protected readonly suggestions = signal<FormulaOption[]>([]);
  protected readonly active = signal(0);
  protected readonly open = computed(() => this.suggestions().length > 0);

  protected optionId(index: number): string {
    return `${this.uid}-opt-${index}`;
  }

  protected onInput(): void {
    this.value.set(this.area().nativeElement.value);
    this.refreshSuggestions();
  }

  protected onKeyup(event: KeyboardEvent): void {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) this.refreshSuggestions();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.open()) return;
    const count = this.suggestions().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.active.update((i) => (i + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.active.update((i) => (i - 1 + count) % count);
        break;
      case 'Enter':
      case 'Tab':
        event.preventDefault();
        this.accept(this.suggestions()[this.active()]);
        break;
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
    }
  }

  /** Recalcula as sugestões a partir da palavra antes do cursor. */
  refreshSuggestions(): void {
    if (this.readonly()) return;
    const el = this.area().nativeElement;
    const word = el.selectionStart === el.selectionEnd ? wordAt(el.value, el.selectionStart) : null;
    const list = word ? suggestFormulaOptions(word.text, this.options()) : [];
    // não sugere o que já está completo e exato
    const useful = list.length === 1 && list[0].key === word?.text ? [] : list;
    this.suggestions.set(useful);
    this.active.set(0);
  }

  close(): void {
    this.suggestions.set([]);
  }

  /** Aceita uma sugestão: troca a palavra sob o cursor (funções já abrem o parêntese). */
  accept(option: FormulaOption | undefined): void {
    if (!option) return;
    const el = this.area().nativeElement;
    const word = wordAt(el.value, el.selectionStart) ?? { start: el.selectionStart, end: el.selectionEnd };
    const { text, caretOffset } = completionFor(option);
    this.apply(replaceRange(el.value, word.start, word.end, text, caretOffset));
    this.close();
  }

  /** Insere operador, parêntese, vírgula, função ou referência no cursor. */
  insert(kind: InsertKind, text: string): void {
    if (this.readonly()) return;
    const el = this.area().nativeElement;
    this.apply(insertAtCursor(el.value, el.selectionStart, el.selectionEnd, { kind, text }));
    this.close();
  }

  protected syncScroll(): void {
    const pre = this.highlight()?.nativeElement;
    if (pre) pre.scrollTop = this.area().nativeElement.scrollTop;
  }

  private apply(result: { value: string; caret: number }): void {
    const el = this.area().nativeElement;
    el.value = result.value;
    el.setSelectionRange(result.caret, result.caret);
    el.focus();
    this.value.set(result.value);
    // a renderização reaplica [value]; garante o cursor no lugar certo depois dela
    afterNextRender(
      () => {
        if (el.selectionStart !== result.caret) el.setSelectionRange(result.caret, result.caret);
      },
      { injector: this.injector },
    );
  }
}
