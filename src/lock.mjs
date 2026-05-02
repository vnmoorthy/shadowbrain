// Single-writer file lock for the shadowbrain DB.
//
// PGLite is a single-process embedded Postgres (WASM). Two `shadowbrain serve`
// processes pointing at the same dataDir will silently corrupt the WAL. v0.1
// addresses this honestly: acquire an exclusive lock on `~/.shadowbrain/db/.lock`
// at startup. If held, refuse to start with a clear error pointing at the
// incumbent PID. Document the limitation in the README.
//
// Implementation: open the lock file with `wx` (exclusive create). If the file
// exists, read the PID and check whether that process is still alive — if not,
// the lock is stale and we steal it. Otherwise refuse.

import { existsSync, openSync, writeSync, closeSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { shadowbrainHome } from './storage/paths.mjs';
import { DbLockedError } from './cli/errors.mjs';

/**
 * Default lock path. Lives in SHADOWBRAIN_HOME, NOT inside the DB dir —
 * PGLite scans its dataDir for its own files and a foreign `.lock` file
 * upsets it.
 */
export function defaultLockPath() {
  return join(shadowbrainHome(), 'serve.lock');
}

let _heldLock = null;

/**
 * Acquire the writer lock. Returns a release function. Throws DbLockedError
 * if another live process holds it OR if this process already holds it.
 *
 * @param {{ lockPath?: string }} [opts]
 * @returns {() => void}
 */
export function acquireDbLock(opts = {}) {
  const lockPath = opts.lockPath || defaultLockPath();
  mkdirSync(dirname(lockPath), { recursive: true });

  // Same-process double-acquisition is a programming error; refuse loudly.
  if (_heldLock && _heldLock.path === lockPath) {
    throw new DbLockedError({ pid: process.pid, lockPath });
  }

  // If a lock file exists, decide whether it's stale.
  if (existsSync(lockPath)) {
    const pid = readPid(lockPath);
    if (pid && isProcessAlive(pid) && pid !== process.pid) {
      throw new DbLockedError({ pid, lockPath });
    }
    // Stale lock (dead pid) or same-pid leftover — remove and continue.
    try { unlinkSync(lockPath); } catch {}
  }

  let fd;
  try {
    fd = openSync(lockPath, 'wx');
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      // Race: another process took it between our existsSync and openSync.
      const pid = readPid(lockPath);
      throw new DbLockedError({ pid, lockPath });
    }
    throw err;
  }

  writeSync(fd, String(process.pid));
  closeSync(fd);

  const release = () => {
    if (!_heldLock || _heldLock.path !== lockPath) return;
    try { unlinkSync(lockPath); } catch {}
    _heldLock = null;
  };

  _heldLock = { path: lockPath, release };

  // Best-effort cleanup on process exit. SIGINT and SIGTERM trigger the same.
  process.once('exit', release);
  process.once('SIGINT', () => { release(); process.exit(130); });
  process.once('SIGTERM', () => { release(); process.exit(143); });

  return release;
}

function readPid(path) {
  try {
    const txt = readFileSync(path, 'utf8').trim();
    const n = Number.parseInt(txt, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    // Signal 0 — checks for permission/existence without delivering a signal.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but we lack permission, so alive.
    return err && err.code === 'EPERM';
  }
}

/**
 * Test/diagnostic helper — returns the current lock state.
 */
export function currentDbLock() {
  return _heldLock;
}
