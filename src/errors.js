/**
 * Error types shared by the CLI.
 *
 * Every error that reaches the top level carries an exit code, so the process
 * never has to guess and never has to print a stack trace.
 */

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_RATE_LIMITED = 2;

export class CliError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = options.exitCode ?? EXIT_ERROR;
    this.hint = options.hint ?? '';
    this.code = options.code ?? 'error';
    this.status = options.status ?? null;
    this.retryAfter = options.retryAfter ?? null;
  }
}

/** A mistake in how the command was invoked (bad flag, missing argument...). */
export function usageError(message, hint = '') {
  return new CliError(message, { exitCode: EXIT_ERROR, code: 'usage', hint });
}

/** The API answered with a non-2xx status. */
export function apiError(message, options = {}) {
  return new CliError(message, { code: 'api', ...options });
}

/** The API could not be reached at all. */
export function networkError(message, options = {}) {
  return new CliError(message, { code: 'network', ...options });
}

/** Normalise anything thrown into a CliError. */
export function toCliError(err) {
  if (err instanceof CliError) return err;
  if (err instanceof Error) {
    return new CliError(err.message || 'Unexpected error.', { code: 'error' });
  }
  return new CliError(String(err), { code: 'error' });
}

/** JSON shape used for `--json` error output. */
export function errorPayload(err) {
  const payload = { error: err.message, code: err.code };
  if (err.hint) payload.hint = err.hint;
  if (err.status) payload.status = err.status;
  if (err.retryAfter !== null && err.retryAfter !== undefined) {
    payload.retryAfter = err.retryAfter;
  }
  return payload;
}
