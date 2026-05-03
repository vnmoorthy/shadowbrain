// Helper: acquire writer lock, open repo, run fn, clean up on every exit path.
//
// Codex-fallback finding #5: every CLI command except `serve` was opening
// PGLite without acquiring the writer lock. Running `shadowbrain decay`
// (or audit/import/export/conflicts/repo) while `shadowbrain serve` was
// up corrupted the WAL — exactly the failure mode src/lock.mjs exists to
// prevent.
//
// Usage:
//   return await withLockedRepo({}, async (repo) => {
//     // do work with repo; lock released and repo closed automatically
//   });

import { acquireDbLock } from '../lock.mjs';
import { openRepo } from '../storage/repository.mjs';

/**
 * @template T
 * @param {object} repoOpts - passed to openRepo
 * @param {(repo: any) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withLockedRepo(repoOpts, fn) {
  const release = acquireDbLock({});
  try {
    const repo = await openRepo(repoOpts);
    try {
      return await fn(repo);
    } finally {
      await repo.close().catch(() => {});
    }
  } finally {
    release();
  }
}
