import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { fileNameFor, resolveWithin, slugify } from '../src/filename.js';

test('slugify keeps a readable, filesystem-safe name', () => {
  assert.equal(slugify('Pride and Prejudice'), 'pride-and-prejudice');
  assert.equal(slugify('Frankenstein; Or, The Modern Prometheus'), 'frankenstein-or-the-modern-prometheus');
  assert.equal(slugify('  spaced  out  '), 'spaced-out');
  assert.equal(slugify('Ünïcødé Tïtlé'), 'unicode-title');
  assert.equal(slugify('***'), 'book');
  assert.equal(slugify(''), 'book');
});

test('slugify never allows path traversal characters', () => {
  const slug = slugify('../../etc/passwd');
  assert.ok(!slug.includes('/'));
  assert.ok(!slug.includes('\\'));
  assert.ok(!slug.includes('..'));
});

test('slugify escapes Windows reserved device names', () => {
  assert.equal(slugify('CON'), '_con');
  assert.equal(slugify('nul'), '_nul');
});

test('fileNameFor appends the extension', () => {
  assert.equal(fileNameFor('Pride and Prejudice', 'epub'), 'pride-and-prejudice.epub');
  assert.equal(fileNameFor('Pride and Prejudice', '.PDF'), 'pride-and-prejudice.pdf');
});

test('fileNameFor keeps two same-titled books apart using the source id', () => {
  const a = fileNameFor('Pride and Prejudice', 'epub', 'pg-1342');
  const b = fileNameFor('Pride and Prejudice, a play', 'epub', 'pg-37431');
  assert.notEqual(a, b);
  assert.equal(a, 'pride-and-prejudice-pg-1342.epub');
  assert.equal(b, 'pride-and-prejudice-a-play-pg-37431.epub');
});

test('resolveWithin keeps the target inside the destination directory', () => {
  const base = path.resolve('/tmp/books');
  assert.equal(resolveWithin(base, 'book.epub'), path.join(base, 'book.epub'));
  assert.equal(resolveWithin(base, '../escape.epub'), null);
  assert.equal(resolveWithin(base, '/etc/passwd'), null);
  assert.equal(resolveWithin(base, 'nested/../../escape.epub'), null);
});
