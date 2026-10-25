/**
 * Entry point: argument parsing, dispatch and top-level error handling.
 *
 * The CLI never prints a stack trace. Every failure becomes a short message
 * and an exit code.
 */

import { ApiClient } from './api.js';
import { resolveConfig, VERSION } from './config.js';
import { CliError, EXIT_ERROR, errorPayload, toCliError, usageError } from './errors.js';
import { createStyler, resolveColor } from './format.js';
import { downloadCommand } from './commands/download.js';
import { healthCommand } from './commands/health.js';
import { resolveCommand } from './commands/resolve.js';
import { searchCommand } from './commands/search.js';

const COMMANDS = {
  search: searchCommand,
  download: downloadCommand,
  resolve: resolveCommand,
  health: healthCommand,
};

const VALUE_OPTIONS = new Set([
  '--api-base',
  '--api-key',
  '--timeout',
  '--limit',
  '--page',
  '--source',
  '--format',
  '--out',
  '--author',
]);

const BOOLEAN_OPTIONS = new Set([
  '--json',
  '--no-color',
  '--free-only',
  '--force',
  '--dry-run',
  '--help',
  '--version',
]);

const SHORT_OPTIONS = { '-h': '--help', '-v': '--version' };

function toCamel(option) {
  return option
    .replace(/^--/, '')
    .replace(/-([a-z0-9])/g, (_, chr) => chr.toUpperCase());
}

/** Parse argv into `{ _: [...], ...flags }`. */
export function parseArgs(argv) {
  const opts = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === '--') {
      opts._.push(...argv.slice(index + 1));
      break;
    }
    if (raw.length > 1 && raw.startsWith('-')) {
      let key = raw;
      let inline;
      const equals = raw.indexOf('=');
      if (equals > -1) {
        key = raw.slice(0, equals);
        inline = raw.slice(equals + 1);
      }
      if (SHORT_OPTIONS[key]) key = SHORT_OPTIONS[key];

      if (VALUE_OPTIONS.has(key)) {
        const value = inline !== undefined ? inline : argv[(index += 1)];
        if (value === undefined) throw usageError(`Option ${key} requires a value.`);
        opts[toCamel(key)] = value;
      } else if (BOOLEAN_OPTIONS.has(key)) {
        if (inline !== undefined) throw usageError(`Option ${key} does not take a value.`);
        opts[toCamel(key)] = true;
      } else {
        throw usageError(
          `Unknown option: ${key}.`,
          'Run `anyfreebook --help` to see the supported options.',
        );
      }
    } else {
      opts._.push(raw);
    }
  }

  return opts;
}

export const GENERAL_HELP = `anyfreebook ${VERSION} — search 12 open-access book sources, download only what is verifiably public domain.

Usage:
  anyfreebook search <query> [options]
  anyfreebook download <query> [options]
  anyfreebook resolve <title> [--author <name>] [options]
  anyfreebook health [options]

Global options:
  --api-base <url>    API base URL            (env ANYFREEBOOK_API_BASE)
  --api-key <key>     API key, optional      (env ANYFREEBOOK_API_KEY)
  --timeout <ms>      Request timeout        (default 20000)
  --json              Print raw JSON to stdout, nothing else
  --no-color          Disable ANSI colour    (NO_COLOR is honoured too)
  --help, -h          Show this help
  --version, -v       Show the version

Exit codes:
  0  success
  1  request or usage error
  2  rate limited (HTTP 429)

Docs: https://anyfreebook.com
`;

export const COMMAND_HELP = {
  search: `
Search — fan one query out across Project Gutenberg, Open Library, the Internet
Archive, Google Books, PubMed Central, DOAJ and LibriVox.

  anyfreebook search <query> [options]

  --limit <n>        Results per page (default 10, max 50)
  --page <n>         Page number (default 1)
  --source <name>    all | gutenberg | openlibrary | archive | googlebooks |
                     pubmed | doaj | librivox | openalex | wikisource |
                     europeana | zenodo | otl   (default all)
  --format <fmt>     Keep only results offering epub | pdf | txt | html
  --free-only        Keep only results with a verified free download
`,
  download: `
Download — search, then write verified public-domain books to a folder.

  anyfreebook download <query> [options]

  --limit <n>        Results to consider (default 5, max 50)
  --source <name>    all | gutenberg | openlibrary | archive | googlebooks |
                     pubmed | doaj | librivox | openalex | wikisource |
                     europeana | zenodo | otl   (default all)
  --format <fmt>     epub | pdf | txt | html (default: best available —
                     epub > pdf > txt > html)
  --out <dir>        Destination folder (default ./books)
  --force            Overwrite files that already exist
  --dry-run          Show what would be downloaded; write nothing
  --free-only        Accepted for symmetry; downloads are always limited to
                     tier=download results
`,
  resolve: `
Resolve — the authoritative legal status of one title.

  anyfreebook resolve <title> [--author <name>] [options]

  --author <name>    Author, to disambiguate between editions
`,
  health: `
Health — check that the API is reachable.

  anyfreebook health [options]
`,
};

function helpFor(command) {
  return command && COMMAND_HELP[command]
    ? `${GENERAL_HELP}${COMMAND_HELP[command]}`
    : GENERAL_HELP;
}

export async function main(argv = [], env = process.env) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    const error = toCliError(err);
    process.stderr.write(`error: ${error.message}\n`);
    if (error.hint) process.stderr.write(`hint: ${error.hint}\n`);
    process.exitCode = error.exitCode;
    return;
  }

  if (opts.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const command = opts._[0];
  if (!command) {
    if (opts.help) {
      process.stdout.write(helpFor(null));
      return;
    }
    process.stderr.write(`error: No command given.\n\n${helpFor(null)}`);
    process.exitCode = EXIT_ERROR;
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(
      `error: Unknown command "${command}". Known commands: ${Object.keys(COMMANDS).join(', ')}.\n\n${helpFor(null)}`,
    );
    process.exitCode = EXIT_ERROR;
    return;
  }

  if (opts.help) {
    process.stdout.write(helpFor(command));
    return;
  }

  const config = resolveConfig(opts, env);
  const color = resolveColor({ noColor: Boolean(opts.noColor), env, stream: process.stdout });
  const style = createStyler({ color });

  const ctx = {
    api: new ApiClient(config),
    config,
    style,
    env,
    json: Boolean(opts.json),
    width: process.stdout.columns || 100,
    out: process.stdout,
    err: process.stderr,
  };

  try {
    await handler(opts, ctx);
  } catch (err) {
    const error = toCliError(err);
    if (ctx.json) {
      process.stdout.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
    } else {
      process.stderr.write(`error: ${error.message}\n`);
      if (error.hint) process.stderr.write(`hint: ${error.hint}\n`);
    }
    process.exitCode = error.exitCode;
  }
}

export { CliError };
