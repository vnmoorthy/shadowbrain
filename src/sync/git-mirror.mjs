// Git-mirror sync — push/pull memory entries to a private git repo.
//
// Each entry is written as a JSON file at:
//
//   <syncRepo>/entries/<repo-slug>/<id>.json
//
// where <repo-slug> is the canonical remote URL with `/` replaced by `--`.
// Tombstones (deleted entries) are kept until the 30-day prune to avoid
// resurrection from stale peers.
//
// We use isomorphic-git (no shell-out) so this works on Windows and inside
// containers without `git` on PATH.

import http from 'isomorphic-git/http/node';
import git from 'isomorphic-git';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync, openSync, writeSync, closeSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { syncRepoPath, configPath, conflictsPath } from '../storage/paths.mjs';
import { resolveConflict } from './conflict-resolver.mjs';
import { openRepo } from '../storage/repository.mjs';
import { uuidv7 } from '../schema/entry.mjs';
import { log } from '../log.mjs';

export async function initMirror({ remote, dir = syncRepoPath() } = {}) {
  if (!remote) throw new Error('initMirror requires --remote');
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, '.git'))) {
    await git.init({ fs, dir, defaultBranch: 'main' });
  }
  const remotes = await git.listRemotes({ fs, dir });
  if (!remotes.find((r) => r.remote === 'origin')) {
    await git.addRemote({ fs, dir, remote: 'origin', url: remote });
  } else {
    await git.addRemote({ fs, dir, remote: 'origin', url: remote, force: true });
  }
  // Persist sync mode to config.
  const cfg = readJsonOrEmpty(configPath());
  cfg.sync = { mode: 'git', remote, dir };
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
  return { dir, remote };
}

export async function mirrorStatus({ dir = syncRepoPath() } = {}) {
  if (!existsSync(join(dir, '.git'))) return { mode: 'local-only' };
  const remotes = await git.listRemotes({ fs, dir });
  const branch = await git.currentBranch({ fs, dir, fullname: false });
  const head = await git.resolveRef({ fs, dir, ref: 'HEAD' }).catch(() => null);
  return { mode: 'git', dir, remotes, branch, head };
}

/**
 * Push: read all live + tombstoned entries from the repository, write them
 * as JSON files into the sync dir, commit, and push to origin.
 *
 * Incremental: we look at sync_state.last_push to skip entries that haven't
 * been touched since the last push.
 */
export async function pushMirror({ dir = syncRepoPath(), author = defaultAuthor() } = {}) {
  if (!existsSync(join(dir, '.git'))) {
    throw new Error(`sync not initialized — run 'shadowbrain sync init --remote <url>'`);
  }
  const repo = await openRepo();
  try {
    const lastPush = await readState(repo, 'last_push');
    const entries = await repo.list({ includeDeleted: true });
    const toWrite = entries.filter((e) => Number(e.lamport || 0) > lastPush);
    if (toWrite.length === 0) {
      log.info('sync push: nothing to push');
      return { pushed: 0 };
    }
    for (const e of toWrite) {
      const filePath = entryPath(dir, e);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(e, null, 2));
      await git.add({ fs, dir, filepath: relative(dir, filePath) });
    }
    const sha = await git.commit({
      fs, dir,
      author: { name: author.name, email: author.email, timestamp: Math.floor(Date.now() / 1000) },
      message: `shadowbrain sync push (${toWrite.length} entries)`,
    });
    await git.push({ fs, http, dir, remote: 'origin', ref: 'main', force: false }).catch((err) => {
      log.warn('git push failed', { error: err.message });
      throw err;
    });
    const maxLamport = toWrite.reduce((m, e) => Math.max(m, Number(e.lamport || 0)), lastPush);
    await writeState(repo, 'last_push', maxLamport);
    return { pushed: toWrite.length, commit: sha };
  } finally {
    await repo.close();
  }
}

/**
 * Pull: fetch + merge from origin, then walk every changed JSON file and
 * upsert into the repository. Conflicts go through resolveConflict() and
 * are appended to ~/.shadowbrain/conflicts.jsonl.
 */
export async function pullMirror({ dir = syncRepoPath() } = {}) {
  if (!existsSync(join(dir, '.git'))) {
    throw new Error(`sync not initialized — run 'shadowbrain sync init --remote <url>'`);
  }
  await git.fetch({ fs, http, dir, remote: 'origin', ref: 'main' });
  // Fast-forward only — anything else fails loud and lets conflict-resolver run.
  const ref = await git.resolveRef({ fs, dir, ref: 'refs/remotes/origin/main' }).catch(() => null);
  if (ref) {
    try {
      await git.merge({ fs, dir, ours: 'main', theirs: 'refs/remotes/origin/main', fastForwardOnly: true });
    } catch (err) {
      log.warn('non-fast-forward, falling back to file-level resolve', { error: err.message });
    }
  }
  const repo = await openRepo();
  let imported = 0, conflicted = 0;
  try {
    const root = join(dir, 'entries');
    if (!existsSync(root)) return { imported: 0, conflicted: 0 };
    for (const f of walk(root)) {
      try {
        const incoming = JSON.parse(readFileSync(f, 'utf8'));
        const existing = await repo.get(incoming.id);
        if (!existing) {
          await repo.put(incoming);
          imported++;
          continue;
        }
        if (Number(incoming.lamport || 0) === Number(existing.lamport || 0)) continue;
        const { resolution, merged, conflict } = resolveConflict(existing, incoming);
        if (conflict) {
          appendConflict(conflict);
          conflicted++;
        }
        if (resolution === 'theirs' || resolution === 'merge') {
          await repo.put(merged);
          imported++;
        }
      } catch (err) {
        log.warn('skip malformed entry file', { file: f, error: err.message });
      }
    }
    await writeState(repo, 'last_pull', Date.now());
    return { imported, conflicted };
  } finally {
    await repo.close();
  }
}

/**
 * Daemon: periodically pull then push. Stops on SIGINT.
 */
export async function runDaemon({ intervalMs = 60_000 } = {}) {
  log.info('sync daemon starting', { intervalMs });
  let stopped = false;
  process.once('SIGINT', () => { stopped = true; });
  process.once('SIGTERM', () => { stopped = true; });
  while (!stopped) {
    try {
      const pull = await pullMirror();
      const push = await pushMirror();
      log.info('sync tick', { ...pull, ...push });
    } catch (err) {
      log.warn('sync tick failed', { error: err.message });
    }
    await sleep(intervalMs);
  }
  log.info('sync daemon stopped');
}

// ─── helpers ────────────────────────────────────────────────────────

function entryPath(dir, e) {
  const slug = (e.repo || 'unknown').replace(/\//g, '--');
  return join(dir, 'entries', slug, `${e.id}.json`);
}

function readJsonOrEmpty(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

function defaultAuthor() {
  return { name: process.env.SHADOWBRAIN_AUTHOR_NAME || 'shadowbrain', email: process.env.SHADOWBRAIN_AUTHOR_EMAIL || 'sync@shadowbrain.local' };
}

async function readState(repo, key) {
  const row = await repo.db.queryOne(
    `SELECT ${key} AS v FROM sb_sync_state WHERE repo = 'global'`
  );
  return Number(row?.v || 0);
}

async function writeState(repo, key, value) {
  await repo.db.query(
    `INSERT INTO sb_sync_state (repo, ${key}, ${key === 'last_push' ? 'last_push_at' : 'last_pull_at'})
     VALUES ('global', $1, NOW())
     ON CONFLICT (repo) DO UPDATE SET ${key} = EXCLUDED.${key}, ${key === 'last_push' ? 'last_push_at' : 'last_pull_at'} = NOW()`,
    [String(value)]
  );
}

function appendConflict(conflict) {
  const p = conflictsPath();
  mkdirSync(dirname(p), { recursive: true });
  const id = uuidv7();
  const entry = JSON.stringify({ id, ...conflict, timestamp: new Date().toISOString() });
  // append-only
  const fd = openSync(p, 'a');
  try {
    writeSync(fd, entry + '\n');
  } finally {
    closeSync(fd);
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && full.endsWith('.json')) yield full;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// isomorphic-git wants a node:fs-shaped fs. Build it lazily so we don't pay
// the import cost when sync is unused.
import * as nodeFs from 'node:fs';
const fs = nodeFs;
