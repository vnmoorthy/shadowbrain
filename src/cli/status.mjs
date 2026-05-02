// `shadowbrain status` — quick at-a-glance summary for v0.1.
//
// Prints version, db path + size, lock state, claude registration. JSON with
// --json. Nothing about sync/trust/decay because v0.1 doesn't have those.

import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { VERSION } from '../version.mjs';
import { shadowbrainHome, defaultDbPath } from '../storage/paths.mjs';
import { defaultLockPath } from '../lock.mjs';
import { openRepoV01 } from '../storage/repository-v01.mjs';

export async function cmdStatus(opts = {}) {
  const home = shadowbrainHome();
  const db = defaultDbPath();
  const lockFile = defaultLockPath();

  const summary = {
    version: VERSION,
    home,
    db: {
      path: db,
      exists: existsSync(db),
      sizeBytes: existsSync(db) ? dirSize(db) : 0,
    },
    lock: readLockState(lockFile),
    entries: await tryEntryCount(),
    claude: detectClaudeRegistration(),
    observe: process.env.SHADOWBRAIN_OBSERVE === '1',
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return 0;
  }

  process.stdout.write(`shadowbrain ${VERSION}\n`);
  process.stdout.write(`  home:     ${home}\n`);
  process.stdout.write(`  db:       ${db} (${summary.db.exists ? formatBytes(summary.db.sizeBytes) : 'empty'})\n`);
  process.stdout.write(`  entries:  ${summary.entries.count != null ? summary.entries.count : '?'}\n`);
  process.stdout.write(
    `  lock:     ${summary.lock.held ? `held by pid ${summary.lock.pid ?? '?'}` : 'free'}\n`
  );
  process.stdout.write(`  observe:  ${summary.observe ? 'on (SHADOWBRAIN_OBSERVE=1)' : 'off'}\n`);
  process.stdout.write(
    `  claude:   ${summary.claude.installed ? 'installed' : 'not on PATH'}` +
    `${summary.claude.registered ? ' (mcp registered)' : ''}\n`
  );
  return 0;
}

function dirSize(p) {
  let total = 0;
  try {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = `${p}/${entry.name}`;
      try {
        const s = statSync(full);
        if (s.isFile()) total += s.size;
        else if (s.isDirectory()) total += dirSize(full);
      } catch {}
    }
  } catch {}
  return total;
}

function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${(n / 1024 ** 3).toFixed(1)}GB`;
}

function readLockState(lockFile) {
  if (!existsSync(lockFile)) return { held: false, pid: null, path: lockFile };
  try {
    const txt = readFileSync(lockFile, 'utf8').trim();
    const pid = Number.parseInt(txt, 10);
    return { held: true, pid: Number.isFinite(pid) ? pid : null, path: lockFile };
  } catch {
    return { held: true, pid: null, path: lockFile };
  }
}

async function tryEntryCount() {
  // Open read-only-ish: we open via openRepoV01 which currently does writes
  // for schema setup — so this is best-effort. If the DB is locked by a live
  // serve, we return null and the user sees '?'.
  let repo;
  try {
    repo = await openRepoV01({});
    const c = await repo.count();
    return { count: c };
  } catch (err) {
    return { count: null, error: err?.message };
  } finally {
    if (repo) await repo.close().catch(() => {});
  }
}

function detectClaudeRegistration() {
  const r = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf8', timeout: 3000 });
  if (r.error || r.status !== 0) return { installed: false, registered: false };
  return { installed: true, registered: (r.stdout || '').toLowerCase().includes('shadowbrain') };
}
