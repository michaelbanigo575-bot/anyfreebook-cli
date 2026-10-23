/**
 * `anyfreebook download` — search, then write verified public-domain books to disk.
 *
 * Only results whose tier is `download` are ever written. `borrow` and
 * `unverified` results are refused with an explanation, never silently skipped.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_DOWNLOAD_LIMIT,
  DEFAULT_OUT_DIR,
  FORMAT_PREFERENCE,
  MAX_LIMIT,
  MAX_QUERY_LENGTH,
  USER_AGENT,
  clampInt,
  validateFormat,
  validateSource,
} from '../config.js';
import { CliError, usageError } from '../errors.js';
import { fileNameFor, resolveWithin } from '../filename.js';
import { humanBytes, partialWarning } from '../format.js';
import { positionalText } from './search.js';

/** Pick the file to download for a result. */
export function pickFile(files, requestedFormat) {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!list.length) return null;
  if (requestedFormat) {
    return list.find((file) => String(file.format).toLowerCase() === requestedFormat) || null;
  }
  for (const format of FORMAT_PREFERENCE) {
    const match = list.find((file) => String(file.format).toLowerCase() === format);
    if (match) return match;
  }
  return null;
}

/** Explain, in plain words, why a non-download result cannot be downloaded. */
export function refusalMessage(result) {
  const tier = String(result?.tier ?? '').toLowerCase();
  const title = result?.title || result?.id || 'This title';
  if (tier === 'borrow') {
    return (
      `"${title}" is borrow-only: a real Internet Archive copy exists but it is lending-restricted. ` +
      'Reading it needs a free Internet Archive account and a loan, so there is no file to download.'
    );
  }
  if (tier === 'unverified') {
    return (
      `"${title}" is unverified: no free, legal copy of this exact title could be confirmed, ` +
      'so there is nothing to download.'
    );
  }
  return `"${title}" has tier "${result?.tier ?? 'unknown'}" — only tier=download results may be downloaded.`;
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Download one URL to disk.
 * Writes to a `.part` file first so an interrupted transfer never leaves a
 * truncated book behind.
 */
export async function downloadFile(url, destination, { timeoutMs, onProgress } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
  } catch (err) {
    const cause = (err && (err.cause || err)) || {};
    const code = cause.code ? ` (${cause.code})` : '';
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new CliError(`Download timed out after ${timeoutMs} ms: ${url}`, { code: 'timeout' });
    }
    throw new CliError(`Could not reach the file host${code}: ${url}`, {
      code: 'network',
      hint: 'Check your connection and retry. The file host may also be temporarily unavailable.',
    });
  }

  if (!response.ok) {
    throw new CliError(`The file host answered HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`, {
      status: response.status,
      code: 'download_failed',
    });
  }

  const lengthHeader = response.headers && response.headers.get('content-length');
  const total = lengthHeader ? Number(lengthHeader) : 0;
  const temporary = `${destination}.part`;
  const handle = await fs.open(temporary, 'w');

  let received = 0;
  try {
    const body = response.body;
    if (body && typeof body.getReader === 'function') {
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          await handle.write(value);
          received += value.byteLength;
          if (onProgress) onProgress(received, total);
        }
      }
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      await handle.write(buffer);
      received = buffer.byteLength;
      if (onProgress) onProgress(received, total);
    }
    await handle.close();
    await fs.rename(temporary, destination);
  } catch (err) {
    await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    if (err instanceof CliError) throw err;
    throw new CliError(`Transfer failed: ${err && err.message ? err.message : String(err)}`, {
      code: 'download_failed',
    });
  }

  return { bytes: received, total };
}

export async function downloadCommand(opts, ctx) {
  const query = positionalText(opts._.slice(1));
  if (!query) {
    throw usageError(
      'Missing search query.',
      'Try: anyfreebook download "pride and prejudice" --format epub',
    );
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw usageError(
      `Query is ${query.length} characters; the API accepts at most ${MAX_QUERY_LENGTH}.`,
      'Shorten the query.',
    );
  }

  const limit = clampInt(opts.limit, DEFAULT_DOWNLOAD_LIMIT, 1, MAX_LIMIT, '--limit');
  const format = validateFormat(opts.format);
  const source = validateSource(opts.source);
  const force = Boolean(opts.force);
  const dryRun = Boolean(opts.dryRun);
  const outDir = path.resolve(opts.out || DEFAULT_OUT_DIR);

  const data = await ctx.api.search({ q: query, page: 1, source, limit });
  const failedSources = Array.isArray(data.failedSources) ? data.failedSources : [];
  if (data.partial || failedSources.length > 0) {
    ctx.err.write(`${partialWarning(failedSources, ctx.style)}\n`);
  }

  const results = Array.isArray(data.results) ? data.results : [];
  const items = [];

  for (const result of results) {
    const title = result?.title || result?.id || 'book';
    if (result?.tier !== 'download') {
      items.push({ status: 'refused', title, book: result, message: refusalMessage(result) });
      continue;
    }
    const file = pickFile(result.files, format);
    if (!file) {
      items.push({
        status: 'skipped',
        title,
        book: result,
        message: format
          ? `No ${format} file was offered for "${title}".`
          : `The API did not return a downloadable file for "${title}".`,
      });
      continue;
    }
    items.push({ status: 'pending', title, book: result, file });
  }

  if (!dryRun && items.some((item) => item.status === 'pending')) {
    await fs.mkdir(outDir, { recursive: true });
  }

  const summary = { downloaded: 0, skipped: 0, failed: 0, refused: 0, planned: 0 };

  for (const item of items) {
    if (item.status === 'refused') {
      summary.refused += 1;
      continue;
    }
    if (item.status === 'skipped') {
      summary.skipped += 1;
      continue;
    }

    const extension = String(item.file.format || 'bin').toLowerCase();
    const name = fileNameFor(item.title, extension, item.book?.id);
    const destination = resolveWithin(outDir, name);
    if (!destination) {
      item.status = 'failed';
      item.message = `Refused to write outside ${outDir}.`;
      summary.failed += 1;
      continue;
    }

    if (!dryRun && (await pathExists(destination)) && !force) {
      item.status = 'skipped';
      item.message = `${destination} already exists — pass --force to overwrite it.`;
      summary.skipped += 1;
      continue;
    }

    if (dryRun) {
      item.status = 'planned';
      item.path = destination;
      item.message = `would download → ${destination}`;
      summary.planned += 1;
      continue;
    }

    try {
      const { bytes } = await downloadFile(item.file.url, destination, {
        timeoutMs: ctx.config.timeoutMs,
        onProgress: (received, total) => {
          if (!ctx.err.isTTY) return;
          const size = total ? `${humanBytes(received)} / ${humanBytes(total)}` : humanBytes(received);
          const percent = total ? ` (${Math.min(100, Math.round((received / total) * 100))}%)` : '';
          const line = `  ↓ ${name}  ${size}${percent}`;
          ctx.err.write(`\r${line.padEnd(72)}`);
        },
      });
      item.status = 'downloaded';
      item.path = destination;
      item.bytes = bytes;
      summary.downloaded += 1;
      ctx.err.write(
        `\r${`  ✓ ${name}  ${humanBytes(bytes)}`.padEnd(72)}\n`,
      );
    } catch (err) {
      item.status = 'failed';
      item.message = err && err.message ? err.message : String(err);
      summary.failed += 1;
      ctx.err.write(`\r${`  ✗ ${name} — ${item.message}`.padEnd(72)}\n`);
    }
  }

  if (ctx.json) {
    ctx.out.write(
      `${JSON.stringify(
        {
          query,
          out: outDir,
          dryRun,
          format: format || 'best-available',
          items: items.map((item) => ({
            title: item.title,
            id: item.book?.id ?? null,
            tier: item.book?.tier ?? null,
            status: item.status,
            format: item.file?.format ?? null,
            url: item.file?.url ?? null,
            path: item.path ?? null,
            bytes: item.bytes ?? null,
            message: item.message ?? null,
          })),
          summary,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const lines = [];
  if (dryRun) {
    lines.push(ctx.style.bold(`Dry run — nothing was written. Destination would be ${outDir}`));
    lines.push('');
  }
  if (!items.length) {
    lines.push(ctx.style.yellow(`No results found for "${query}".`));
  }
  for (const item of items) {
    const mark =
      item.status === 'downloaded' || item.status === 'planned'
        ? ctx.style.green('✓')
        : item.status === 'refused'
          ? ctx.style.yellow('⊘')
          : ctx.style.red('✗');
    const detail =
      item.status === 'downloaded'
        ? `${item.path} (${humanBytes(item.bytes)})`
        : item.message || item.status;
    lines.push(`${mark} ${item.title} — ${detail}`);
  }
  lines.push('');
  lines.push(
    ctx.style.bold('Summary:') +
      ` downloaded ${summary.downloaded} · skipped ${summary.skipped} · failed ${summary.failed} · refused ${summary.refused}` +
      (dryRun ? ` · would download ${summary.planned}` : ''),
  );
  if (summary.refused) {
    lines.push(
      ctx.style.dim(
        'Refused results are not downloadable: tier=borrow needs a free Internet Archive account and a loan, ' +
          'tier=unverified means no free copy of that exact title could be confirmed.',
      ),
    );
  }

  ctx.out.write(`${lines.join('\n')}\n`);
}
