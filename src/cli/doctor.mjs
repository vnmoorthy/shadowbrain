// `shadowbrain doctor` — diagnostics for v0.1 reality.
//
// Each check returns { name, pass, detail, fix? }. We print a checklist by
// default and JSON with --json. Exit code is non-zero if any required check
// fails.
//
// Per the /autoplan DX review (finding D3): existing "doctor" was checking
// vaporware. v0.1 checks only what v0.1 actually does.

import { existsSync, accessSync, constants as fsc, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { VERSION } from '../version.mjs';
import { shadowbrainHome, defaultDbPath } from '../storage/paths.mjs';
import { acquireDbLock } from '../lock.mjs';
import { openRepoV01 } from '../storage/repository-v01.mjs';

export async function cmdDoctor(opts = {}) {
  const checks = [];

  checks.push(check_node_version());
  checks.push(check_home_writable());
  checks.push(await check_lock_acquirable());
  checks.push(await check_pglite_open_and_migrate());
  checks.push(await check_search_engine());
  if (opts['claude-cli-check'] !== false) {
    checks.push(check_claude_cli());
    checks.push(check_claude_mcp_registered());
  }
  if (opts['update-check'] !== false) {
    checks.push(await check_update_available());
  }

  const allRequiredPass = checks.every((c) => c.pass || c.optional);
  const out = { version: VERSION, allPass: checks.every((c) => c.pass), allRequiredPass, checks };

  if (opts.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return out.allRequiredPass ? 0 : 1;
  }

  process.stdout.write(`shadowbrain doctor (v${VERSION})\n\n`);
  for (const c of checks) {
    const mark = c.pass ? '\x1b[32m✓\x1b[0m' : c.optional ? '\x1b[33m!\x1b[0m' : '\x1b[31m✗\x1b[0m';
    process.stdout.write(`  ${mark} ${c.name.padEnd(28)} ${c.detail || ''}\n`);
    if (!c.pass && c.fix) {
      process.stdout.write(`    \x1b[2mfix:\x1b[0m ${c.fix}\n`);
    }
  }
  process.stdout.write(out.allRequiredPass ? '\nall green.\n' : '\nfailures detected — see above.\n');
  return out.allRequiredPass ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────

function check_node_version() {
  const ver = process.versions.node;
  const major = Number.parseInt(ver.split('.')[0], 10);
  return {
    name: 'node version',
    pass: major >= 20,
    detail: `node ${ver} (need >= 20)`,
    fix: major >= 20 ? null : `install node 20 or 22 (https://nodejs.org)`,
  };
}

function check_home_writable() {
  const home = shadowbrainHome();
  try {
    mkdirSync(home, { recursive: true });
    accessSync(home, fsc.W_OK);
    // also test we can actually write a file
    const probe = join(home, '.write-test');
    writeFileSync(probe, 'ok');
    rmSync(probe);
    return { name: 'home writable', pass: true, detail: home };
  } catch (err) {
    return {
      name: 'home writable',
      pass: false,
      detail: `cannot write to ${home}`,
      fix: `set SHADOWBRAIN_HOME to a writable path, or fix filesystem permissions on ${home}`,
    };
  }
}

async function check_lock_acquirable() {
  // Probe the writer lock under a temporary path so we don't trip the real
  // serve lock if one is held by another process.
  const probePath = join(shadowbrainHome(), '.lock-probe');
  let release;
  try {
    release = acquireDbLock({ lockPath: probePath });
    return { name: 'lock acquirable', pass: true, detail: probePath };
  } catch (err) {
    return {
      name: 'lock acquirable',
      pass: false,
      detail: err.message,
      fix: err.fix || `another shadowbrain process may be running. 'lsof ${probePath}' to inspect.`,
    };
  } finally {
    if (release) release();
  }
}

async function check_pglite_open_and_migrate() {
  const t0 = performance.now();
  let repo;
  try {
    repo = await openRepoV01({ ephemeral: true });
    const ms = (performance.now() - t0).toFixed(1);
    return { name: 'pglite open + migrate', pass: true, detail: `cold start ${ms}ms` };
  } catch (err) {
    return {
      name: 'pglite open + migrate',
      pass: false,
      detail: err.message,
      fix: `npm install --force inside the package, or 'shadowbrain reset' if the existing DB is corrupt`,
    };
  } finally {
    if (repo) await repo.close().catch(() => {});
  }
}

async function check_search_engine() {
  // v0.1 ships LIKE-only — predictable, no tsvector dependency. The check
  // exists so v0.2+ can flip the detail string to 'tsvector' without
  // changing doctor's output structure.
  return { name: 'search engine', pass: true, detail: 'like (v0.1)' };
}

function check_claude_cli() {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (r.error || (r.status !== 0 && !r.stdout)) {
    return {
      name: 'claude CLI on PATH',
      pass: false,
      optional: true,
      detail: `not found`,
      fix: `install Claude Code from https://claude.com/code, or use the JSON-paste install fallback in the README`,
    };
  }
  const out = (r.stdout || '').trim().split('\n')[0];
  return { name: 'claude CLI on PATH', pass: true, detail: out || 'present' };
}

function check_claude_mcp_registered() {
  const r = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    return {
      name: 'claude mcp registered',
      pass: false,
      optional: true,
      detail: `'claude mcp list' failed`,
      fix: `claude mcp add shadowbrain -- shadowbrain serve`,
    };
  }
  const registered = (r.stdout || '').includes('shadowbrain');
  return {
    name: 'claude mcp registered',
    pass: registered,
    optional: true,
    detail: registered ? 'shadowbrain found in mcp list' : 'not registered',
    fix: registered ? null : `claude mcp add shadowbrain -- shadowbrain serve`,
  };
}

async function check_update_available() {
  if (process.env.SHADOWBRAIN_NO_UPDATE_CHECK === '1') {
    return { name: 'update check', pass: true, detail: 'skipped (env)', optional: true };
  }
  // Cache file: ~/.shadowbrain/.update-checked-YYYY-MM-DD
  const today = new Date().toISOString().slice(0, 10);
  const cachePath = join(shadowbrainHome(), `.update-checked-${today}`);
  if (existsSync(cachePath)) {
    return { name: 'update check', pass: true, detail: 'cached today', optional: true };
  }
  try {
    mkdirSync(shadowbrainHome(), { recursive: true });
    const res = await fetchWithTimeout('https://registry.npmjs.org/shadowbrain', 3000);
    if (!res.ok) throw new Error(`npm registry ${res.status}`);
    const j = await res.json();
    const latest = j['dist-tags']?.latest || VERSION;
    writeFileSync(cachePath, latest);
    if (latest !== VERSION) {
      return {
        name: 'update check',
        pass: true,
        optional: true,
        detail: `${VERSION} installed, ${latest} available — 'npm i -g shadowbrain@${latest}'`,
      };
    }
    return { name: 'update check', pass: true, detail: `${VERSION} (latest)`, optional: true };
  } catch (err) {
    return { name: 'update check', pass: true, optional: true, detail: `skipped (${err.message})` };
  }
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
