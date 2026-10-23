/**
 * Terminal formatting.
 *
 * Colour is opt-out: NO_COLOR, a non-TTY stdout, or --no-color all disable it.
 * No ANSI escape ever ends up in JSON output.
 */

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  gray: '\u001b[90m',
};

/**
 * Decide whether ANSI colour should be used.
 * @param {{noColor?: boolean, env?: object, stream?: object}} options
 */
export function resolveColor({ noColor = false, env = {}, stream = process.stdout } = {}) {
  if (noColor) return false;
  const environment = env || {};
  if (environment.NO_COLOR !== undefined && environment.NO_COLOR !== '') return false;
  if (environment.FORCE_COLOR === '0') return false;
  if (environment.FORCE_COLOR !== undefined && environment.FORCE_COLOR !== '') return true;
  return Boolean(stream && stream.isTTY);
}

/** Create a tiny styling helper bound to a colour decision. */
export function createStyler({ color = false } = {}) {
  const wrap = (name) => (text) => (color ? `${ANSI[name]}${text}${ANSI.reset}` : String(text));
  return {
    color,
    bold: wrap('bold'),
    dim: wrap('dim'),
    red: wrap('red'),
    green: wrap('green'),
    yellow: wrap('yellow'),
    blue: wrap('blue'),
    magenta: wrap('magenta'),
    cyan: wrap('cyan'),
    gray: wrap('gray'),
  };
}

const TIER_STYLE = {
  download: (style) => style.green('download'),
  borrow: (style) => style.yellow('borrow'),
  unverified: (style) => style.gray('unverified'),
};

/** Colour a tier label, falling back to the plain word for unknown tiers. */
export function formatTier(tier, style) {
  const key = String(tier ?? '').toLowerCase();
  const painter = TIER_STYLE[key];
  return painter ? painter(style) : String(tier ?? 'unknown');
}

/** Shorten text to `width` characters, using an ellipsis when it does not fit. */
export function truncate(text, width) {
  const value = String(text ?? '');
  if (width <= 0) return '';
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

/** Human readable byte size. */
export function humanBytes(bytes) {
  if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes))) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** Formats available on a search result. */
export function formatsOf(result) {
  const files = Array.isArray(result?.files) ? result.files : [];
  const formats = [];
  for (const file of files) {
    const format = file && file.format ? String(file.format).toLowerCase() : '';
    if (format && !formats.includes(format)) formats.push(format);
  }
  return formats.length ? formats.join(', ') : '—';
}

const GUTTER = '  ';

/**
 * Render the search result table.
 * Column widths are computed from the plain text so ANSI codes never break the
 * alignment.
 */
export function renderSearchTable(results, { style, width = process.stdout.columns || 100 } = {}) {
  const columns = [
    { label: 'TITLE', width: 50, min: 22 },
    { label: 'AUTHOR', width: 24, min: 10 },
    { label: 'SOURCE', width: 20, min: 10 },
    { label: 'TIER', width: 10, min: 9 },
    { label: 'FORMATS', width: 22, min: 8 },
  ];

  const fixedTotal = columns.slice(1).reduce((sum, col) => sum + col.width, 0);
  const gutterTotal = GUTTER.length * (columns.length - 1);
  const available = Math.max(30, width - fixedTotal - gutterTotal);
  columns[0].width = Math.max(columns[0].min, Math.min(columns[0].width, available));

  const rawRows = results.map((result) => [
    result?.title || result?.id || '(untitled)',
    result?.author || '—',
    result?.source || result?.sourceType || '—',
    String(result?.tier ?? 'unknown'),
    formatsOf(result),
  ]);

  const widths = columns.map((col, index) =>
    rawRows.reduce((max, row) => Math.max(max, String(row[index] ?? '').length), col.label.length),
  );

  const pad = (text, width) => text + ' '.repeat(Math.max(0, width - text.length));

  const header = columns.map((col, index) => style.bold(pad(col.label, widths[index]))).join(GUTTER).trimEnd();
  const divider = columns.map((col, index) => style.dim('-'.repeat(widths[index]))).join(GUTTER).trimEnd();

  const body = rawRows.map((row) =>
    row
      .map((cell, index) => {
        const plain = truncate(String(cell ?? ''), widths[index]);
        const shown = index === 3 ? formatTier(plain, style) : plain;
        return shown + ' '.repeat(Math.max(0, widths[index] - plain.length));
      })
      .join(GUTTER)
      .trimEnd(),
  );

  return [header, divider, ...body].join('\n');
}

/** One-line explanation of what a tier means. */
export function tierLegend(style) {
  return (
    `${style.green('download')} = verified public-domain full text · ` +
    `${style.yellow('borrow')} = lending-restricted (needs a free Internet Archive account + loan) · ` +
    `${style.gray('unverified')} = no confirmed free copy of this exact title`
  );
}

/** Warning shown when some upstream sources did not answer. */
export function partialWarning(failedSources, style) {
  const names = Array.isArray(failedSources) ? failedSources.filter(Boolean) : [];
  const listed = names.length ? names.join(', ') : 'one or more sources';
  return (
    `${style.yellow('Warning:')} partial results — ${listed} did not respond. ` +
    'The list below is incomplete, not empty.'
  );
}
