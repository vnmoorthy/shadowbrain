// Decay tests — run across simulated weeks of usage to verify the curve.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decayConfidence, pruneBelow } from '../../src/decay/scorer.mjs';
import { runDecayJob } from '../../src/decay/job.mjs';
import { openRepo } from '../../src/storage/repository.mjs';

test('confidence: brand-new entry has no decay', () => {
  const e = {
    confidence: 0.7,
    created_at: new Date().toISOString(),
    last_modified_at: new Date().toISOString(),
    last_used_at: null,
    use_count: 0,
  };
  const c = decayConfidence(e);
  assert.ok(c > 0.69 && c <= 0.7);
});

test('confidence halves at ~140 days at default rate', () => {
  const long = 140;
  const past = new Date(Date.now() - long * 86400_000).toISOString();
  const e = { confidence: 1.0, created_at: past, last_modified_at: past, last_used_at: past, use_count: 0 };
  const c = decayConfidence(e);
  // exp(-0.005 * 140) ≈ 0.497
  assert.ok(c > 0.45 && c < 0.55, `expected ~0.5, got ${c}`);
});

test('use_count gives a small boost', () => {
  const past = new Date(Date.now() - 10 * 86400_000).toISOString();
  const e1 = { confidence: 0.7, created_at: past, last_modified_at: past, last_used_at: past, use_count: 0 };
  const e2 = { ...e1, use_count: 10 };
  assert.ok(decayConfidence(e2) > decayConfidence(e1));
});

test('pruneBelow filters', () => {
  const old = new Date(Date.now() - 365 * 86400_000).toISOString();
  const recent = new Date().toISOString();
  const entries = [
    { id: '1', confidence: 0.5, last_modified_at: recent, last_used_at: recent, use_count: 0 },
    { id: '2', confidence: 0.05, last_modified_at: old, last_used_at: null, use_count: 0 },
    { id: '3', confidence: 0.9, last_modified_at: recent, last_used_at: recent, use_count: 5 },
  ];
  const drop = pruneBelow(entries, 0.05);
  assert.equal(drop.length, 1);
  assert.equal(drop[0].id, '2');
});

test('runDecayJob — applies confidence updates and prunes', async () => {
  const repo = await openRepo({ ephemeral: true });
  try {
    const fresh = await repo.put({
      repo: 'r', topic: 't', kind: 'pattern',
      title: 'fresh', body: 'fresh body',
    });
    // simulate aged entry by manually editing last_modified_at + confidence
    const aged = await repo.put({
      repo: 'r', topic: 'u', kind: 'pattern',
      title: 'aged', body: 'aged body',
    });
    const past = new Date(Date.now() - 400 * 86400_000).toISOString();
    await repo.db.query(
      `UPDATE sb_v01_entries SET created_at = $1, last_modified_at = $1, last_used_at = NULL, confidence = 0.05 WHERE id = $2`,
      [past, aged.id]
    );
    const result = await runDecayJob(repo, { rate: 0.005, threshold: 0.05 });
    assert.ok(result.decayed >= 1);
    // The aged entry with confidence already at 0.05 will decay further then
    // be pruned.
    const after = await repo.get(aged.id);
    assert.equal(after, null, 'aged entry should be tombstoned');
    const stillThere = await repo.get(fresh.id);
    assert.ok(stillThere, 'fresh entry should remain');
  } finally {
    await repo.close();
  }
});

test('runDecayJob --dry-run does not modify state', async () => {
  const repo = await openRepo({ ephemeral: true });
  try {
    const past = new Date(Date.now() - 400 * 86400_000).toISOString();
    const e = await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'x', body: 'y' });
    await repo.db.query(
      `UPDATE sb_v01_entries SET created_at = $1, last_modified_at = $1, last_used_at = NULL, confidence = 0.05 WHERE id = $2`,
      [past, e.id]
    );
    const before = await repo.get(e.id);
    const result = await runDecayJob(repo, { rate: 0.005, threshold: 0.05, dryRun: true });
    assert.ok(result.pruned >= 1);
    const after = await repo.get(e.id);
    assert.deepEqual(after?.confidence, before?.confidence, 'dry-run should not modify');
  } finally {
    await repo.close();
  }
});

test('simulated 8 weeks: regularly-used entry stays high; never-used entry drops', async () => {
  // Synthetic: an entry used weekly stays near 1.0; an entry untouched
  // drops well below.
  const usedWeekly = {
    confidence: 1.0,
    created_at: new Date(Date.now() - 7 * 86400_000).toISOString(),
    last_modified_at: new Date(Date.now() - 7 * 86400_000).toISOString(),
    last_used_at: new Date(Date.now() - 7 * 86400_000).toISOString(),
    use_count: 8,
  };
  const untouched = {
    confidence: 1.0,
    created_at: new Date(Date.now() - 56 * 86400_000).toISOString(),
    last_modified_at: new Date(Date.now() - 56 * 86400_000).toISOString(),
    last_used_at: null,
    use_count: 0,
  };
  const a = decayConfidence(usedWeekly);
  const b = decayConfidence(untouched);
  assert.ok(a > b);
  assert.ok(a > 0.9, `regularly-used should stay > 0.9, got ${a}`);
  assert.ok(b < 0.85, `untouched-8wk should drop < 0.85, got ${b}`);
});
