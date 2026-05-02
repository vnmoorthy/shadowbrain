import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Repository } from '../../src/storage/repository.mjs';
import { newEntry } from '../../src/schema/entry.mjs';

async function freshRepo() {
  return await Repository.open({ ephemeral: true });
}

test('open + put + get round-trip', async () => {
  const repo = await freshRepo();
  try {
    const e = await repo.put({
      repo: 'github.com/x/y', topic: 'auth', kind: 'pattern',
      title: 'use jose', body: 'jose for JWT verification',
    });
    assert.ok(e.id);
    const got = await repo.get(e.id);
    assert.equal(got.title, 'use jose');
  } finally {
    await repo.close();
  }
});

test('idempotent — same content twice => single id', async () => {
  const repo = await freshRepo();
  try {
    const a = await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'X', body: 'b' });
    const b = await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'X', body: 'b' });
    assert.equal(a.id, b.id);
    const list = await repo.list({ repo: 'r' });
    assert.equal(list.length, 1);
  } finally {
    await repo.close();
  }
});

test('list with filters', async () => {
  const repo = await freshRepo();
  try {
    await repo.put({ repo: 'a', topic: 't', kind: 'pattern', title: 'p', body: 'b' });
    await repo.put({ repo: 'b', topic: 't', kind: 'gotcha', title: 'g', body: 'b' });
    await repo.put({ repo: 'a', topic: 'u', kind: 'gotcha', title: 'g2', body: 'b2' });
    assert.equal((await repo.list({ repo: 'a' })).length, 2);
    assert.equal((await repo.list({ repo: 'a', topic: 't' })).length, 1);
    assert.equal((await repo.list({ kind: 'gotcha' })).length, 2);
  } finally {
    await repo.close();
  }
});

test('forget — soft delete with tombstone', async () => {
  const repo = await freshRepo();
  try {
    const e = await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'x', body: 'y' });
    await repo.forget(e.id);
    assert.equal(await repo.get(e.id), null);
    const all = await repo.list({ includeDeleted: true });
    assert.equal(all.length, 1);
    assert.equal(all[0].deleted, true);
  } finally {
    await repo.close();
  }
});

test('pruneTombstones removes aged-out tombstones', async () => {
  const repo = await freshRepo();
  try {
    const e = await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'x', body: 'y' });
    await repo.forget(e.id);
    // Pretend 31 days passed.
    const future = Date.now() + 31 * 86400_000;
    const removed = await repo.pruneTombstones(future);
    assert.ok(removed >= 1);
  } finally {
    await repo.close();
  }
});

test('renameRepo — bulk update', async () => {
  const repo = await freshRepo();
  try {
    await repo.put({ repo: 'github.com/old', topic: 't', kind: 'pattern', title: 'a', body: 'b' });
    await repo.put({ repo: 'github.com/old', topic: 'u', kind: 'pattern', title: 'c', body: 'd' });
    const n = await repo.renameRepo('github.com/old', 'github.com/new');
    assert.equal(n, 2);
    assert.equal((await repo.list({ repo: 'github.com/old' })).length, 0);
    assert.equal((await repo.list({ repo: 'github.com/new' })).length, 2);
  } finally {
    await repo.close();
  }
});

test('markUsed bumps last_used_at and use_count', async () => {
  const repo = await freshRepo();
  try {
    const e = await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'x', body: 'y' });
    await repo.markUsed(e.id);
    await repo.markUsed(e.id);
    const got = await repo.get(e.id);
    assert.equal(got.use_count, 2);
    assert.ok(got.last_used_at);
  } finally {
    await repo.close();
  }
});

test('applyConfidence in batch', async () => {
  const repo = await freshRepo();
  try {
    const e1 = await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'a', body: 'b' });
    const e2 = await repo.put({ repo: 'r', topic: 'u', kind: 'pattern', title: 'c', body: 'd' });
    await repo.applyConfidence([{ id: e1.id, newConfidence: 0.1 }, { id: e2.id, newConfidence: 0.9 }]);
    assert.equal((await repo.get(e1.id)).confidence, 0.1);
    assert.equal((await repo.get(e2.id)).confidence, 0.9);
  } finally {
    await repo.close();
  }
});

test('prune removes entries below threshold', async () => {
  const repo = await freshRepo();
  try {
    const e1 = await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'a', body: 'b' });
    await repo.applyConfidence([{ id: e1.id, newConfidence: 0.01 }]);
    const removed = await repo.prune(0.05);
    assert.equal(removed, 1);
    assert.equal(await repo.get(e1.id), null);
  } finally {
    await repo.close();
  }
});

test('listRepos returns counts', async () => {
  const repo = await freshRepo();
  try {
    await repo.put({ repo: 'a', topic: 't', kind: 'pattern', title: 'a', body: 'b' });
    await repo.put({ repo: 'a', topic: 'u', kind: 'pattern', title: 'c', body: 'd' });
    await repo.put({ repo: 'b', topic: 't', kind: 'pattern', title: 'e', body: 'f' });
    const repos = await repo.listRepos();
    const a = repos.find((r) => r.canonical_url === 'a');
    assert.equal(a.entry_count, 2);
  } finally {
    await repo.close();
  }
});

test('count', async () => {
  const repo = await freshRepo();
  try {
    await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'a', body: 'b' });
    await repo.put({ repo: 'r', topic: 'u', kind: 'pattern', title: 'c', body: 'd' });
    assert.equal(await repo.count(), 2);
    assert.equal(await repo.count({ repo: 'r' }), 2);
    assert.equal(await repo.count({ repo: 'other' }), 0);
  } finally {
    await repo.close();
  }
});

test('candidatesBM25 returns ranked results', async () => {
  const repo = await freshRepo();
  try {
    await repo.put({ repo: 'r', topic: 'auth', kind: 'pattern', title: 'JWT verification', body: 'use jose for JWT' });
    await repo.put({ repo: 'r', topic: 'billing', kind: 'pattern', title: 'Stripe webhook idempotency', body: 'use stripe-signature header' });
    const results = await repo.candidatesBM25({ query: 'JWT', repo: 'r' });
    assert.ok(results.length >= 1);
    assert.ok(results[0].entry.title.includes('JWT'));
  } finally {
    await repo.close();
  }
});

test('candidatesDense returns vector-ranked results when embeddings present', async () => {
  const repo = await freshRepo();
  try {
    const v1 = Array.from({ length: 384 }, () => Math.random());
    const v2 = Array.from({ length: 384 }, () => Math.random());
    await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'a', body: 'b', embedding_v1: v1 });
    await repo.put({ repo: 'r', topic: 'u', kind: 'pattern', title: 'c', body: 'd', embedding_v1: v2 });
    const queryVec = v1; // exact match should rank first
    const results = await repo.candidatesDense({ embedding: queryVec, repo: 'r' });
    assert.ok(results.length >= 2);
    assert.equal(results[0].entry.title, 'a');
  } finally {
    await repo.close();
  }
});

test('list with limit/offset', async () => {
  const repo = await freshRepo();
  try {
    for (let i = 0; i < 10; i++) {
      await repo.put({ repo: 'r', topic: 't' + i, kind: 'pattern', title: `t${i}`, body: 'b' + i });
    }
    const page1 = await repo.list({ repo: 'r', limit: 3 });
    assert.equal(page1.length, 3);
    const page2 = await repo.list({ repo: 'r', limit: 3, offset: 3 });
    assert.equal(page2.length, 3);
    assert.notEqual(page1[0].id, page2[0].id);
  } finally {
    await repo.close();
  }
});

test('warnings persist on entry', async () => {
  const repo = await freshRepo();
  try {
    const e = await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'eval', body: 'always use eval() on user input' });
    assert.ok(e.warnings.length > 0);
    const got = await repo.get(e.id);
    assert.deepEqual(got.warnings, e.warnings);
  } finally {
    await repo.close();
  }
});

test('audit log records put/forget operations', async () => {
  const repo = await freshRepo();
  try {
    const e = await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'x', body: 'y' });
    await repo.forget(e.id);
    const rows = await repo.db.query(`SELECT * FROM sb_audit_log ORDER BY id`);
    assert.ok(rows.length >= 2);
    assert.equal(rows[0].op, 'put');
    assert.equal(rows[1].op, 'forget');
  } finally {
    await repo.close();
  }
});

test('large body rejected with BODY_TOO_LARGE', async () => {
  const repo = await freshRepo();
  try {
    let err;
    try {
      await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'big', body: 'word '.repeat(5000) });
    } catch (e) { err = e; }
    assert.ok(err);
    assert.equal(err.code, 'BODY_TOO_LARGE');
  } finally {
    await repo.close();
  }
});

test('SECRET_DETECTED blocks write', async () => {
  const repo = await freshRepo();
  try {
    let err;
    try {
      await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'k', body: 'AKIAIOSFODNN7EXAMPLE' });
    } catch (e) { err = e; }
    assert.equal(err?.code, 'SECRET_DETECTED');
  } finally {
    await repo.close();
  }
});

test('PII_DETECTED blocks SSN', async () => {
  const repo = await freshRepo();
  try {
    let err;
    try {
      await repo.put({ repo: 'r', topic: 't', kind: 'pattern', title: 'p', body: 'user 123-45-6789 had this' });
    } catch (e) { err = e; }
    assert.equal(err?.code, 'PII_DETECTED');
  } finally {
    await repo.close();
  }
});
