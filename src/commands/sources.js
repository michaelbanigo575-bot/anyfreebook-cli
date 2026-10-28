/**
 * `anyfreebook sources` — what the API searches, and what a result from each
 * source actually means.
 *
 * The point of this command is that "free" is not one thing. A source can
 * hand you a file you can download right now, a catalogue record with no file
 * at all, or a lending copy that needs an account. Listing them together is
 * the honest way to show which is which.
 */

import { formatTier } from '../format.js';

/** The tier each kind of source can produce, as the API reports it. */
function tierTone(tier) {
  if (tier === 'download') return 'download';
  if (tier === 'borrow') return 'borrow';
  return 'unverified';
}

export async function sourcesCommand(opts, ctx) {
  const data = await ctx.api.sources();
  const sources = Array.isArray(data.sources) ? data.sources : [];

  if (ctx.json) {
    ctx.out.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }

  if (sources.length === 0) {
    ctx.out.write('The API returned no sources.\n');
    return;
  }

  const lines = [];
  lines.push(`${ctx.style.bold(String(sources.length))} sources, and what a result from each one means:`);
  lines.push('');

  for (const source of sources) {
    const tier = formatTier(source.tier, ctx.style);
    const files = source.providesFiles ? 'file attached' : 'no file, links to the source';
    const size = source.catalogueSize ? ` — ${source.catalogueSize}` : '';
    lines.push(`${ctx.style.bold(source.label)}${size}`);
    lines.push(`  ${source.kind} · tier ${tier} · ${files}`);
    if (source.description) lines.push(`  ${source.description}`);
    lines.push(`  ${source.homepage}`);
    lines.push('');
  }

  lines.push(ctx.style.dim('A "download" tier means the source attaches a file you can fetch now.'));
  lines.push(ctx.style.dim('A "borrow" tier is a real copy the lending library restricts, and'));
  lines.push(ctx.style.dim('"unverified" is a catalogue record whose licence is not confirmed.'));

  ctx.out.write(`${lines.join('\n')}\n`);
}

export { tierTone };
