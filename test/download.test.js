/**
 * The download command must fetch the book that was asked for.
 *
 * The search fans out to sources that match free text, so a query can return
 * real, downloadable documents whose titles are not the title that was asked
 * for. A real case: "Pride and Prejudice" returns academic papers about
 * prejudice, and one of them carries a perfectly good PDF. Downloading the
 * top hits without checking their titles means fetching the wrong book.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { startMockApi } from './mock-api.js';
import { titleMatches } from '../src/commands/download.js';

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

test('titleMatches accepts the title and a subtitle', () => {
  assert.equal(titleMatches('Pride and Prejudice', 'Pride and Prejudice'), true);
  assert.equal(titleMatches('pride and prejudice', 'Pride and Prejudice'), true);
  assert.equal(titleMatches('Pride and Prejudice', 'Pride and Prejudice: A Study'), true);
});

test('titleMatches rejects a different book that merely shares words', () => {
  assert.equal(titleMatches('Pride and Prejudice', 'Alice in Wonderland'), false);
  assert.equal(titleMatches('Pride and Prejudice', 'Pride and Prejudice in the air'), false);
  assert.equal(titleMatches('health nutrition', 'Nutrition and Metabolic Health'), false);
});

test('titleMatches treats a single word as a keyword', () => {
  assert.equal(titleMatches('metabolic', 'Nutrition and Metabolic Health'), true);
  assert.equal(titleMatches('metabolic', 'Pride and Prejudice'), false);
});

test('download skips a downloadable result whose title is not the one asked for', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'afb-dl-'));
  try {
    // Both words appear in the result's title, so the search returns it — but
    // the title is not the phrase that was asked for.
    const result = await run(['download', 'health nutrition', '--api-base', base, '--out', out]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /skipped/i);
    assert.match(result.stdout, /as if it were the book you asked for/i);
    const files = await fs.readdir(out);
    assert.equal(files.length, 0, 'nothing should have been written');
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test('download fetches the file when the title does match', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'afb-dl-'));
  try {
    const result = await run(['download', 'metabolic', '--api-base', base, '--out', out]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /downloaded 1/i);
    const files = await fs.readdir(out);
    assert.equal(files.length, 1);
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test('download uses --author to resolve one exact title', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'afb-dl-'));
  try {
    const result = await run([
      'download',
      'moby',
      '--author',
      'Herman Melville',
      '--api-base',
      base,
      '--out',
      out,
    ]);
    assert.equal(result.code, 0);
    // The resolved Moby-Dick copy is borrow-only, so it must be refused with
    // the reason, not downloaded and not silently dropped.
    assert.match(result.stdout, /borrow-only/i);
    const files = await fs.readdir(out);
    assert.equal(files.length, 0);
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});
