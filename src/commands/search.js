/**
 * `anyfreebook search` — fan out one query across the open-access sources.
 */

import {
  DEFAULT_SEARCH_LIMIT,
  MAX_LIMIT,
  MAX_QUERY_LENGTH,
  clampInt,
  validateFormat,
  validateSource,
} from '../config.js';
import { usageError } from '../errors.js';
import { formatTier, partialWarning, renderSearchTable, tierLegend } from '../format.js';

/** Join the positional arguments into a single piece of text. */
export function positionalText(parts) {
  return parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** True when the result carries a file in the requested format. */
export function hasFormat(result, format) {
  if (!format) return true;
  const files = Array.isArray(result?.files) ? result.files : [];
  return files.some((file) => file && String(file.format).toLowerCase() === format);
}

export async function searchCommand(opts, ctx) {
  const query = positionalText(opts._.slice(1));
  if (!query) {
    throw usageError('Missing search query.', 'Try: anyfreebook search "pride and prejudice"');
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw usageError(
      `Query is ${query.length} characters; the API accepts at most ${MAX_QUERY_LENGTH}.`,
      'Shorten the query.',
    );
  }

  const limit = clampInt(opts.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_LIMIT, '--limit');
  const page = clampInt(opts.page, 1, 1, 1000, '--page');
  const source = validateSource(opts.source);
  const format = validateFormat(opts.format);
  const freeOnly = Boolean(opts.freeOnly);

  const data = await ctx.api.search({ q: query, page, source, limit });
  const all = Array.isArray(data.results) ? data.results : [];
  const results = all.filter(
    (result) => (!freeOnly || result?.tier === 'download') && hasFormat(result, format),
  );

  const failedSources = Array.isArray(data.failedSources) ? data.failedSources : [];
  const partial = Boolean(data.partial) || failedSources.length > 0;
  if (partial) {
    // Always surfaced: on stderr in both modes so `--json` stdout stays pure.
    ctx.err.write(`${partialWarning(failedSources, ctx.style)}\n`);
  }

  if (ctx.json) {
    ctx.out.write(
      `${JSON.stringify({ ...data, results, count: results.length }, null, 2)}\n`,
    );
    return;
  }

  const total = Number.isFinite(Number(data.total)) ? Number(data.total) : all.length;
  const lines = [];
  lines.push(`${ctx.style.bold('Query')}   ${query}`);
  lines.push(
    `${ctx.style.bold('Page')}    ${page} · limit ${limit} · ${all.length} returned · ${total} total matches`,
  );

  const sourceCounts = data.sources && typeof data.sources === 'object' ? data.sources : {};
  const sourceEntries = Object.entries(sourceCounts);
  if (sourceEntries.length) {
    const shown = sourceEntries
      .slice(0, 6)
      .map(([name, count]) => `${name} ${count}`)
      .join(' · ');
    const extra = sourceEntries.length > 6 ? ` · +${sourceEntries.length - 6} more` : '';
    lines.push(`${ctx.style.bold('Sources')} ${shown}${extra}`);
  }
  lines.push('');

  if (!results.length) {
    if (freeOnly && all.length) {
      lines.push(
        ctx.style.yellow(
          `No results with a verified free download. The search returned ${all.length} result(s), ` +
            'but none of them had tier=download.',
        ),
      );
    } else if (format && all.length) {
      lines.push(
        ctx.style.yellow(
          `No results with a ${format} file. The search returned ${all.length} result(s), ` +
            'but none of them offered that format.',
        ),
      );
    } else {
      lines.push(ctx.style.yellow(`No results found for "${query}".`));
    }
  } else {
    lines.push(renderSearchTable(results, { style: ctx.style, width: ctx.width }));
    lines.push('');
    if (results.length < all.length) {
      const filters = [];
      if (freeOnly) filters.push('tier=download');
      if (format) filters.push(`format=${format}`);
      lines.push(
        ctx.style.dim(
          `Showing ${results.length} of ${all.length} results on this page (filtered by ${filters.join(', ')}).`,
        ),
      );
    }
    if (total > all.length) {
      lines.push(ctx.style.dim(`More results available — use --page ${page + 1} for the next page.`));
    }
    lines.push('');
    lines.push(ctx.style.dim(tierLegend(ctx.style)));
  }

  ctx.out.write(`${lines.join('\n')}\n`);
}
