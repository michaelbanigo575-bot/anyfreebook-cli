import assert from 'node:assert/strict';
import test from 'node:test';

import { parseArgs } from '../src/cli.js';

test('parses positional arguments and global flags', () => {
  const opts = parseArgs(['search', 'pride and prejudice', '--limit', '5', '--json']);
  assert.deepEqual(opts._, ['search', 'pride and prejudice']);
  assert.equal(opts.limit, '5');
  assert.equal(opts.json, true);
});

test('supports --flag=value form', () => {
  const opts = parseArgs(['search', 'python', '--limit=25', '--api-base=https://example.test/v1']);
  assert.equal(opts.limit, '25');
  assert.equal(opts.apiBase, 'https://example.test/v1');
});

test('supports short help and version flags', () => {
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-v']).version, true);
});

test('maps kebab-case options to camelCase', () => {
  const opts = parseArgs(['download', 'python', '--dry-run', '--no-color', '--out', './books']);
  assert.equal(opts.dryRun, true);
  assert.equal(opts.noColor, true);
  assert.equal(opts.out, './books');
});

test('rejects unknown options', () => {
  assert.throws(() => parseArgs(['search', 'python', '--nope']), /Unknown option/);
});

test('rejects a value option without a value', () => {
  assert.throws(() => parseArgs(['search', 'python', '--limit']), /requires a value/);
});
