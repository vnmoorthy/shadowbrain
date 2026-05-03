// Regression test for codex-fallback finding #5
//
// Every CLI command except `serve` was opening Repository without acquiring
// the writer lock. Running `shadowbrain decay` (or audit/import/export/
// conflicts/repo) while `shadowbrain serve` was up would corrupt the WAL.
//
// The fix routes those commands through withLockedRepo() (or the explicit
// lock pattern in sync.mjs). This test verifies that the lock IS acquired:
// we hold it ourselves, then call the command's wrapper, and assert it
// throws DB_LOCKED.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTmpHome } from '../_helpers/tmp-home.mjs';
import { acquireDbLock } from '../../src/lock.mjs';
import { withLockedRepo } from '../../src/cli/_with-locked-repo.mjs';

test('withLockedRepo refuses when serve already holds the lock', withTmpHome(async () => {
  // Simulate `shadowbrain serve` holding the lock.
  const release = acquireDbLock({});
  try {
    await assert.rejects(
      () => withLockedRepo({}, async () => 'should not reach'),
      (err) => {
        assert.equal(err.code, 'DB_LOCKED', `expected DB_LOCKED, got ${err.code}`);
        return true;
      }
    );
  } finally {
    release();
  }
}));

test('withLockedRepo releases the lock on success', withTmpHome(async () => {
  await withLockedRepo({}, async (repo) => {
    assert.ok(repo, 'repo handle exposed');
    return 'ok';
  });
  // Subsequent acquisition must succeed — lock was released.
  const release = acquireDbLock({});
  release();
}));

test('withLockedRepo releases the lock on error', withTmpHome(async () => {
  await assert.rejects(
    () => withLockedRepo({}, async () => { throw new Error('boom'); }),
    /boom/
  );
  // Even though the inner fn threw, the lock must have been released.
  const release = acquireDbLock({});
  release();
}));
