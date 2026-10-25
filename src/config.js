/**
 * Configuration, limits and validation helpers.
 *
 * Everything here is deliberately dependency-free and side-effect free so the
 * same values can be reused by the CLI and by the tests.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { usageError } from './errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function readVersion() {
  try {
    const raw = readFileSync(path.join(here, '..', 'package.json'), 'utf8');
    return JSON.parse(raw).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = readVersion();

export const DEFAULT_API_BASE = 'https://anyfreebook.com/api/v1';
export const DEFAULT_TIMEOUT_MS = 20000;
export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_DOWNLOAD_LIMIT = 5;
export const DEFAULT_OUT_DIR = './books';
export const MAX_LIMIT = 50;
export const MAX_QUERY_LENGTH = 200;

/** Source identifiers accepted by the `source` query parameter. */
export const SOURCES = [
  'all',
  'gutenberg',
  'openlibrary',
  'archive',
  'googlebooks',
  'pubmed',
  'doaj',
  'librivox',
  'openalex',
  'wikisource',
  'europeana',
  'zenodo',
  'otl',
];

/** File formats the CLI knows how to download. */
export const FORMATS = ['epub', 'pdf', 'txt', 'html'];

/** Preference order used when no explicit `--format` is given. */
export const FORMAT_PREFERENCE = ['epub', 'pdf', 'txt', 'html'];

export const USER_AGENT = `anyfreebook-cli/${VERSION} (+https://anyfreebook.com)`;

/**
 * Merge CLI flags with environment variables.
 * Flags win, then env, then the built-in defaults.
 */
export function resolveConfig(flags = {}, env = {}) {
  const base = String(flags.apiBase || env.ANYFREEBOOK_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
  const apiKey = String(flags.apiKey || env.ANYFREEBOOK_API_KEY || '').trim();
  const timeoutMs =
    flags.timeout !== undefined && flags.timeout !== null
      ? Number(flags.timeout)
      : env.ANYFREEBOOK_TIMEOUT_MS !== undefined
        ? Number(env.ANYFREEBOOK_TIMEOUT_MS)
        : DEFAULT_TIMEOUT_MS;

  return {
    base: base || DEFAULT_API_BASE,
    apiKey,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

/** Parse an integer option and clamp it into [min, max]. */
export function clampInt(value, fallback, min, max, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw usageError(`${label} must be a whole number (got "${value}").`);
  }
  if (parsed < min || parsed > max) {
    throw usageError(`${label} must be between ${min} and ${max} (got ${parsed}).`);
  }
  return parsed;
}

/** Validate the `--source` option. */
export function validateSource(value) {
  if (value === undefined || value === null || value === '') return 'all';
  const normalized = String(value).trim().toLowerCase();
  if (!SOURCES.includes(normalized)) {
    throw usageError(
      `Unknown source "${value}".`,
      `Valid sources: ${SOURCES.join(', ')}.`,
    );
  }
  return normalized;
}

/** Validate the `--format` option. */
export function validateFormat(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase().replace(/^\./, '');
  if (!FORMATS.includes(normalized)) {
    throw usageError(
      `Unknown format "${value}".`,
      `Valid formats: ${FORMATS.join(', ')}.`,
    );
  }
  return normalized;
}
