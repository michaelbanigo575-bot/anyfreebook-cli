/**
 * `anyfreebook resolve` — authoritative legal status for one specific title.
 */

import { usageError } from '../errors.js';
import { formatTier } from '../format.js';
import { positionalText } from './search.js';

export async function resolveCommand(opts, ctx) {
  const title = positionalText(opts._.slice(1));
  if (!title) {
    throw usageError(
      'Missing title.',
      'Try: anyfreebook resolve "Pride and Prejudice" --author "Jane Austen"',
    );
  }
  const author = typeof opts.author === 'string' ? opts.author.trim() : '';

  const data = await ctx.api.resolve({ title, author: author || undefined });

  if (ctx.json) {
    ctx.out.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }

  const files = Array.isArray(data.files) ? data.files : [];
  const links = Array.isArray(data.links) ? data.links : [];
  const lines = [];

  lines.push(ctx.style.bold(data.title || title));
  if (data.author) lines.push(`${ctx.style.bold('Author')}   ${data.author}`);
  lines.push(`${ctx.style.bold('Tier')}     ${formatTier(data.tier, ctx.style)}`);
  if (data.tierReason) lines.push(`${ctx.style.bold('Reason')}   ${data.tierReason}`);
  if (data.license) lines.push(`${ctx.style.bold('License')}  ${data.license}`);
  if (data.sourceUrl || data.sourceType) {
    const source = data.sourceType ? ` (${data.sourceType})` : '';
    lines.push(`${ctx.style.bold('Source')}   ${data.sourceUrl || data.sourceType}${source}`);
  }
  lines.push('');

  lines.push(`${ctx.style.bold(`Files (${files.length})`)}`);
  if (files.length) {
    for (const file of files) {
      const label = file.label || String(file.format || 'file').toUpperCase();
      const size = file.bytes ? ` — ${file.bytes} bytes` : '';
      lines.push(`  ${label.padEnd(10)} ${file.url}${size}`);
    }
  } else {
    lines.push(ctx.style.dim('  none — this title has no direct file URL.'));
  }
  lines.push('');

  lines.push(`${ctx.style.bold(`Links (${links.length})`)}`);
  if (links.length) {
    for (const link of links) {
      const source = link.source ? ` [${link.source}]` : '';
      lines.push(`  ${link.label || 'Link'}${source} — ${link.url}`);
    }
  } else {
    lines.push(ctx.style.dim('  none'));
  }
  lines.push('');

  if (data.tier === 'download') {
    lines.push(ctx.style.dim(`Next: anyfreebook download "${data.title || title}" --format epub`));
  } else if (data.tier === 'borrow') {
    lines.push(
      ctx.style.dim(
        'Borrow-only: read it on the source site with a free Internet Archive account and a loan — it cannot be downloaded.',
      ),
    );
  } else {
    lines.push(
      ctx.style.dim('Unverified: no confirmed free copy of this exact title, so the CLI will not download it.'),
    );
  }

  ctx.out.write(`${lines.join('\n')}\n`);
}
