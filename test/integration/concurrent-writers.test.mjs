import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTmpHome } from '../_helpers/tmp-home.mjs';
import { acquireDbLock } from '../../src/lock.mjs';

test('concurrent writers: second acquireDbLock throws DB_LOCKED', withTmpHome(async (_t, dir) => {
  const release1 = acquireDbLock({ lockPath: `${dir}/.lock` });
  try {
    assert.throws(
      () => acquireDbLock({ lockPath: `${dir}/.lock` }),
      (err) => {
        assert.equal(err.code, 'DB_LOCKED');
        assert.match(err.message, /lock/);
        return true;
      }
    );
  } finally {
    release1();
  }
}));

test('concurrent writers: stale lock (dead pid) is reclaimed', withTmpHome(async (_t, dir) => {
  // Write a lock file with a PID that definitely doesn't exist.
  const { writeFileSync } = await import('node:fs');
  const lockPath = `${dir}/.lock`;
  writeFileSync(lockPath, '999999999'); // safely out of pid range
  // Should NOT throw — stale lock gets stolen.
  const release = acquireDbLock({ lockPath });
  release();
}));

test('concurrent writers: release allows re-acquisition', withTmpHome(async (_t, dir) => {
  const release1 = acquireDbLock({ lockPath: `${dir}/.lock` });
  release1();
  const release2 = acquireDbLock({ lockPath: `${dir}/.lock` });
  release2();
}));
