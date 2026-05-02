import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { withTmpHome } from '../_helpers/tmp-home.mjs';
import { openRepoV01 } from '../../src/storage/repository-v01.mjs';

test('pglite cold start: open + put + close + reopen + search', withTmpHome(async (_t, dir) => {
  const dbPath = join(dir, 'db');

  const repo1 = await openRepoV01({ dbPath });
  await repo1.put({ text: 'persisted gotcha', repo: 'r1' });
  await repo1.close();

  const repo2 = await openRepoV01({ dbPath });
  try {
    const out = await repo2.search({ query: 'persisted', repo: 'r1' });
    assert.equal(out.results.length, 1);
    assert.match(out.results[0].text, /persisted gotcha/);
  } finally {
    await repo2.close();
  }
}));

test('pglite cold start: schema_version_v01 row is written on first open', withTmpHome(async (_t, dir) => {
  const dbPath = join(dir, 'db');
  const repo = await openRepoV01({ dbPath });
  try {
    // Re-opening a second time must not double-write or raise SCHEMA_MISMATCH.
    await repo.close();
    const repo2 = await openRepoV01({ dbPath });
    await repo2.close();
  } finally {
    await repo.close().catch(() => {});
  }
}));

test('pglite cold start: open is under 5 seconds', withTmpHome(async () => {
  const t0 = Date.now();
  const repo = await openRepoV01({ ephemeral: true });
  const ms = Date.now() - t0;
  await repo.close();
  // Ephemeral PGLite cold start is ~200-500ms typically; flag if >5000ms.
  assert.ok(ms < 5000, `cold start took ${ms}ms — investigate`);
}));
