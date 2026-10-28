/**
 * End-to-end CLI checks against the local mock API.
 * No network access: everything points at 127.0.0.1.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { startMockApi } from './mock-api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const binary = path.join(here, '..', 'bin', 'anyfreebook.js');

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [binary, ...args], {
      env: { ...process.env, NO_COLOR: '1', ...env },
      cwd: here,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

let server;
let base;

test.before(async () => {
  server = await startMockApi();
  base = server.url;
});

test.after(async () => {
  if (server) await server.close();
});

test('--help prints usage and exits 0', async () => {
  const result = await run(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /anyfreebook search/);
});

test('search prints a table with tiers', async () => {
  const result = await run(['search', 'pride', '--api-base', base]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /TITLE/);
  assert.match(result.stdout, /Pride and Prejudice/);
  assert.match(result.stdout, /download/);
});

test('search --json emits valid JSON only on stdout', async () => {
  const result = await run(['search', 'pride', '--api-base', base, '--json']);
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.apiVersion, undefined);
  assert.ok(Array.isArray(payload.results));
  assert.ok(payload.results.length > 0);
  assert.equal(payload.results[0].tier, 'download');
});

test('search surfaces partial results on stderr', async () => {
  const result = await run(['search', 'partial', '--api-base', base]);
  assert.equal(result.code, 0);
  assert.match(result.stderr, /partial results/i);
  assert.match(result.stderr, /PubMed Central/);
});

test('search --free-only explains an empty filtered set', async () => {
  const result = await run(['search', 'borrowonly', '--api-base', base, '--free-only']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /No results with a verified free download/i);
});

test('download refuses non-download tiers', async () => {
  const result = await run(['download', 'pride', '--api-base', base, '--dry-run']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /refused/i);
  assert.match(result.stdout, /borrow|unverified/i);
});

test('download --dry-run writes nothing', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'anyfreebook-dry-'));
  const result = await run(['download', 'pride', '--api-base', base, '--out', out, '--dry-run']);
  assert.equal(result.code, 0);
  const entries = await fs.readdir(out);
  assert.deepEqual(entries, []);
  assert.match(result.stdout, /Dry run/);
});

test('download writes a file into --out', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'anyfreebook-dl-'));
  const result = await run(['download', 'pride', '--api-base', base, '--out', out, '--format', 'epub']);
  assert.equal(result.code, 0);
  const entries = await fs.readdir(out);
  // The source id is part of the file name so two books with the same title
  // do not collide.
  assert.ok(
    entries.includes('pride-and-prejudice-pg-1342.epub'),
    `unexpected files: ${entries.join(', ')}`,
  );
});

test('a 429 exits with code 2 and reports the retry delay', async () => {
  const result = await run(['search', 'ratelimit', '--api-base', base]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Rate limited/i);
  assert.match(result.stderr, /30 second/);
});

test('a 401 explains how to authenticate', async () => {
  const result = await run(['search', 'unauthorized', '--api-base', base]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ANYFREEBOOK_API_KEY/);
});

test('an unreachable API fails gracefully without a stack trace', async () => {
  const result = await run(['search', 'python', '--api-base', 'http://127.0.0.1:9/api/v1']);
  assert.equal(result.code, 1);
  assert.doesNotMatch(result.stderr, /at Object\.|at Module\./);
  assert.match(result.stderr, /Could not reach/);
});

test('resolve prints tier, reason and files', async () => {
  const result = await run(['resolve', 'Pride and Prejudice', '--api-base', base]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Tier\s+download/);
  assert.match(result.stdout, /Public domain/);
  assert.match(result.stdout, /EPUB/);
});

test('health prints the API status', async () => {
  const result = await run(['health', '--api-base', base]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /ok/);
});

test('sources lists every source with its tier', async () => {
  const result = await run(['sources', '--api-base', base]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Project Gutenberg/);
  assert.match(result.stdout, /download/);
  assert.match(result.stdout, /unverified/);
  assert.match(result.stdout, /file attached/);
});

test('sources --json emits valid JSON only on stdout', async () => {
  const result = await run(['sources', '--api-base', base, '--json']);
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.ok(Array.isArray(payload.sources));
  assert.equal(payload.sources[0].id, 'gutenberg');
});
