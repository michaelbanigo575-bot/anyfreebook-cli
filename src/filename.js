/**
 * Filename helpers.
 *
 * Downloaded books are named after their title. Titles come from a remote API,
 * so they are treated as untrusted input: the result is always a single flat
 * file name that stays inside the destination directory.
 */

import path from 'node:path';

const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Letters that NFKD leaves alone but that a readable slug should keep.
 * Without this, "ø" would silently disappear from a file name.
 */
const TRANSLITERATIONS = {
  ø: 'o', Ø: 'O', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe',
  ß: 'ss', đ: 'd', Đ: 'd', ł: 'l', Ł: 'l', þ: 'th', Þ: 'th',
  ð: 'd', Ð: 'd', ħ: 'h', Ħ: 'h', ŋ: 'ng', Ŋ: 'ng',
};

/**
 * Turn an arbitrary title into a lowercase, hyphenated, filesystem-safe slug.
 * Never returns an empty string.
 */
export function slugify(input, { maxLength = 120 } = {}) {
  const source = String(input ?? '')
    .replace(/[øØæÆœŒßđĐłŁþÞðÐħĦŋŊ]/g, (char) => TRANSLITERATIONS[char] ?? char)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  let slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength).replace(/-+$/, '');
  }
  if (!slug) slug = 'book';
  if (WINDOWS_RESERVED.has(slug)) slug = `_${slug}`;
  return slug;
}

/**
 * Build the file name for a download: `<slug>.<ext>`.
 *
 * When the source id is known it is appended (`<slug>-pg-1342.epub`).
 * Two different books can slugify to the same title — "Pride and Prejudice"
 * and "Pride and Prejudice, a play" both become `pride-and-prejudice` — and
 * without the id the second one would be skipped as a duplicate of the first.
 */
export function fileNameFor(title, extension, id) {
  const ext = String(extension ?? '').replace(/^\.+/, '').replace(/[^a-z0-9]/gi, '') || 'bin';
  const suffix = id ? `-${slugify(id, { maxLength: 24 })}` : '';
  return `${slugify(title)}${suffix}.${ext.toLowerCase()}`;
}

/**
 * Resolve `name` inside `dir` and guarantee the result stays inside it.
 * Returns null when the name would escape the directory.
 */
export function resolveWithin(dir, name) {
  const base = path.resolve(dir);
  const target = path.resolve(base, name);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}
