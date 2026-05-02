// Sync chaos test.
//
// 10 engineers, each writes 5 entries while offline. We then sync them in
// every possible reconnect order (sampled), and assert the final dataset is
// identical regardless of order.
//
// The conflict resolver itself is exercised at the function level (no git
// roundtrip). The git wire is tested separately in test/e2e/sync.test.mjs
// when SHADOWBRAIN_TEST_GIT_REMOTE is set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConflict } from '../../src/sync/conflict-resolver.mjs';
import { newEntry, entryContentHash } from '../../src/schema/entry.mjs';

function makeEntry(id, lamport, overrides = {}) {
  return newEntry({
    id,
    repo: 'r',
    topic: 't',
    kind: 'pattern',
    title: 'X',
    body: 'b',
    lamport,
    ...overrides,
  });
}

test('higher lamport wins when no arrays would be lost', () => {
  const a = makeEntry(uniqueUuid(), 1, { title: 'mine' });
  const b = { ...a, lamport: 2, title: 'theirs', body: 'b2' };
  const r = resolveConflict(a, b);
  assert.equal(r.resolution, 'theirs');
  assert.equal(r.merged.title, 'theirs');
});

test('equal lamports → last_modified_at breaks the tie', () => {
  const id = uniqueUuid();
  const a = makeEntry(id, 5, { last_modified_at: '2026-01-01T00:00:00Z', title: 'a' });
  const b = makeEntry(id, 5, { last_modified_at: '2026-02-01T00:00:00Z', title: 'b' });
  const r = resolveConflict(a, b);
  assert.equal(r.resolution, 'theirs');
});

test('equal lamports + equal timestamps → machine name lex breaks tie', () => {
  const id = uniqueUuid();
  const a = makeEntry(id, 5, { last_modified_at: '2026-01-01T00:00:00Z', author: { agent: 'x', user: 'u', machine: 'mac-A' } });
  const b = makeEntry(id, 5, { last_modified_at: '2026-01-01T00:00:00Z', author: { agent: 'x', user: 'u', machine: 'mac-B' } });
  const r = resolveConflict(a, b);
  assert.equal(r.resolution, 'mine'); // mac-A < mac-B
});

test('array union — tags merge', () => {
  const id = uniqueUuid();
  const a = makeEntry(id, 5, { context: { tags: ['auth', 'jwt'], files: [], symbols: [], deps: [] } });
  const b = makeEntry(id, 5, { context: { tags: ['auth', 'security'], files: [], symbols: [], deps: [] } });
  // last_modified_at unchanged → tie → would normally last-write but arrays differ → merge
  const r = resolveConflict(a, b);
  assert.equal(r.resolution, 'merge');
  assert.deepEqual(new Set(r.merged.context.tags), new Set(['auth', 'jwt', 'security']));
});

test('warnings union', () => {
  const id = uniqueUuid();
  const a = makeEntry(id, 5, { warnings: ['uses eval'] });
  const b = makeEntry(id, 5, { warnings: ['uses eval', 'curl|bash pattern'] });
  const r = resolveConflict(a, b);
  // Different array contents → merge path
  assert.equal(r.resolution, 'merge');
  assert.deepEqual(new Set(r.merged.warnings), new Set(['uses eval', 'curl|bash pattern']));
});

test('use_count picks max', () => {
  const id = uniqueUuid();
  const a = makeEntry(id, 5, { use_count: 12, context: { tags: ['x'], files: [], symbols: [], deps: [] } });
  const b = makeEntry(id, 5, { use_count: 7, context: { tags: ['y'], files: [], symbols: [], deps: [] } });
  const r = resolveConflict(a, b);
  assert.equal(r.merged.use_count, 12);
});

test('chaos — 10 engineers, random reconnect order, deterministic final state', () => {
  const id = 'fixed-test-id';
  // Build 10 versions of the same entry, each with different tags.
  const versions = [];
  for (let i = 0; i < 10; i++) {
    versions.push(newEntry({
      id,
      repo: 'r', topic: 't', kind: 'pattern',
      title: `v${i}`,
      body: `body ${i}`,
      lamport: i + 1,
      context: { tags: [`tag-${i}`], files: [], symbols: [], deps: [] },
      author: { agent: 'a', user: 'u', machine: `box-${i}` },
    }));
  }

  // For 30 random reconnect orders, fold via resolveConflict and check
  // they all produce equivalent final state (same scalar fields, same set
  // of tags).
  const finals = [];
  for (let trial = 0; trial < 30; trial++) {
    const order = shuffle([...versions], trial);
    let cur = order[0];
    for (let i = 1; i < order.length; i++) {
      const r = resolveConflict(cur, order[i]);
      cur = r.merged;
    }
    finals.push(cur);
  }
  // Scalar fields: title/body should be the highest-lamport version
  for (const f of finals) {
    assert.equal(f.title, 'v9');
    assert.equal(f.body, 'body 9');
  }
  // Tags set should be identical regardless of order
  const tagSets = finals.map((f) => new Set(f.context.tags || []));
  for (let i = 1; i < tagSets.length; i++) {
    assert.deepEqual(
      [...tagSets[0]].sort(),
      [...tagSets[i]].sort(),
      `final state diverged on trial ${i}`
    );
  }
  // Should have all 10 tags
  assert.equal(tagSets[0].size, 10);
});

test('different entry ids — refuses to merge', () => {
  const a = makeEntry(uniqueUuid(), 1);
  const b = makeEntry(uniqueUuid(), 2);
  assert.throws(() => resolveConflict(a, b), /different ids/);
});

test('one side null', () => {
  const a = makeEntry(uniqueUuid(), 1);
  const r = resolveConflict(a, null);
  assert.equal(r.resolution, 'mine');
  const r2 = resolveConflict(null, a);
  assert.equal(r2.resolution, 'theirs');
});

// ─── helpers ────────────────────────────────────────────────────────

function shuffle(arr, seed) {
  const a = [...arr];
  let h = seed * 9301 + 49297;
  for (let i = a.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uniqueUuid() {
  // not crypto, just unique enough for tests
  const hex = (n) => Math.floor(Math.random() * (16 ** n)).toString(16).padStart(n, '0');
  return `${hex(8)}-${hex(4)}-7${hex(3)}-8${hex(3)}-${hex(12)}`;
}
