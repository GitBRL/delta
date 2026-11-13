/** Saída em tabela (padrão), JSON (--json) ou CSV (--csv), com números no formato brasileiro. */
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatValue(value, unit) {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number') return String(value);
  switch (unit) {
    case 'currency':
      return currency.format(value);
    case 'percent':
      return `${number.format(value)}%`;
    case 'duration':
      return `${number.format(value)} s`;
    default:
      return number.format(value);
  }
}

export function formatChange(pct) {
  if (pct === null || pct === undefined) return '—';
  return `${pct > 0 ? '+' : ''}${number.format(pct)}%`;
}

export function table(rows, columns) {
  if (rows.length === 0) return 'Nada encontrado.\n';
  const cells = rows.map((row) => columns.map((c) => String(c.value(row) ?? '')));
  const widths = columns.map((c, i) => Math.max(c.label.length, ...cells.map((r) => r[i].length)));
  const line = (values) => values.map((v, i) => (columns[i].align === 'right' ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join('  ').trimEnd();
  return `${[line(columns.map((c) => c.label)), line(widths.map((w) => '─'.repeat(w))), ...cells.map(line)].join('\n')}\n`;
}

export function csv(rows, columns) {
  const escape = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return `${[columns.map((c) => escape(c.key ?? c.label)).join(';'), ...rows.map((row) => columns.map((c) => escape(c.raw ? c.raw(row) : c.value(row))).join(';'))].join('\n')}\n`;
}

/** Escolhe o formato pelas flags. */
export function render(flags, data, rows, columns) {
  if (flags.json) return `${JSON.stringify(data, null, 2)}\n`;
  if (flags.csv) return csv(rows, columns);
  return table(rows, columns);
}
