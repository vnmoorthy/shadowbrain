// Typed errors for the CLI and MCP server.
//
// Each error carries:
//   code     — machine-readable, stable across versions
//   message  — short human description
//   fix      — concrete next step (the user-facing remediation)
//   docs_url — link into the README section that explains
//
// CLI top-level catches these and prints `code` + `message` + `fix`. The MCP
// server returns them as `{ ok: false, error: { code, message, hint } }`.

export class ShadowbrainError extends Error {
  constructor({ code, message, fix, docsUrl }) {
    super(message);
    this.name = 'ShadowbrainError';
    this.code = code;
    this.fix = fix;
    this.docsUrl = docsUrl;
  }
  toJSON() {
    return { code: this.code, message: this.message, hint: this.fix, docs: this.docsUrl };
  }
}

export class DbLockedError extends ShadowbrainError {
  constructor({ pid, lockPath }) {
    super({
      code: 'DB_LOCKED',
      message: `another shadowbrain process holds the database lock` + (pid ? ` (pid ${pid})` : ''),
      fix: `wait for it to exit, or remove the stale lock at ${lockPath} if you're sure no other process is running`,
      docsUrl: 'https://github.com/vnmoorthy/shadowbrain#known-limitations',
    });
    this.pid = pid;
    this.lockPath = lockPath;
  }
}

export class MigrationError extends ShadowbrainError {
  constructor({ from, to, cause }) {
    super({
      code: 'MIGRATION_FAILED',
      message: `database migration ${from} → ${to} failed: ${cause}`,
      fix: `run 'shadowbrain doctor --json' and open an issue with the output`,
      docsUrl: 'https://github.com/vnmoorthy/shadowbrain/issues/new',
    });
  }
}

export class SchemaMismatchError extends ShadowbrainError {
  constructor({ found, expected }) {
    super({
      code: 'SCHEMA_MISMATCH',
      message: `database schema version ${found} is not compatible with shadowbrain ${expected}`,
      fix: `your DB was written by a different version. Back up ~/.shadowbrain/db, run 'shadowbrain reset', then 'shadowbrain serve'.`,
      docsUrl: 'https://github.com/vnmoorthy/shadowbrain#upgrade--recovery',
    });
  }
}

export class ClaudeCliMissingError extends ShadowbrainError {
  constructor() {
    super({
      code: 'CLAUDE_CLI_MISSING',
      message: `'claude' CLI not found on PATH`,
      fix: `install Claude Code from https://claude.com/code, or skip with --no-claude-cli-check`,
      docsUrl: 'https://github.com/vnmoorthy/shadowbrain#requirements',
    });
  }
}

export class HomeNotWritableError extends ShadowbrainError {
  constructor({ home }) {
    super({
      code: 'HOME_NOT_WRITABLE',
      message: `cannot write to ${home}`,
      fix: `check filesystem permissions, or set SHADOWBRAIN_HOME=/some/writable/path`,
      docsUrl: 'https://github.com/vnmoorthy/shadowbrain#requirements',
    });
  }
}

export class InvalidArgError extends ShadowbrainError {
  constructor({ name, message }) {
    super({
      code: 'INVALID_ARG',
      message: `${name}: ${message}`,
      fix: `see 'shadowbrain --help' or the tool description in your MCP client`,
      docsUrl: 'https://github.com/vnmoorthy/shadowbrain#cli',
    });
  }
}

export class BodyTooLargeError extends ShadowbrainError {
  constructor({ approxTokens, max }) {
    super({
      code: 'BODY_TOO_LARGE',
      message: `text is approximately ${approxTokens} tokens; max is ${max}`,
      fix: `summarize before calling memory_put. Long entries hurt retrieval quality anyway.`,
      docsUrl: 'https://github.com/vnmoorthy/shadowbrain#what-it-stores',
    });
  }
}

/**
 * Format an error for human display in the CLI. The MCP server uses
 * err.toJSON() instead.
 */
export function formatErrorForCli(err) {
  if (err instanceof ShadowbrainError) {
    let s = `\n  ✗ ${err.code}: ${err.message}\n`;
    if (err.fix) s += `    fix: ${err.fix}\n`;
    if (err.docsUrl) s += `    docs: ${err.docsUrl}\n`;
    return s;
  }
  return `\n  ✗ ${err?.stack || err?.message || err}\n`;
}
