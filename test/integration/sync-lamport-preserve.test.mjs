// Regression test for codex-fallback finding #1
//
// Repository.put({...}, { fromSync: true }) must preserve the incoming
// lamport and last_modified_at. Without this, every entry pulled from a
// peer gets re-stamped with the local clock and then pushed back, breaking
// Lamport correctness across machines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRepoV01 } from '../../src/storage/repository-v01.mjs';
import { openRepo, Repository } from '../../src/storage/repository.mjs';
import { uuidv7 } from '../../src/schema/entry.mjs';
import { withTmpHome } from '../_helpers/tmp-home.mjs';

test('Repository.put with fromSync preserves incoming lamport', withTmpHome(async () => {
  const repo = await openRepo({ ephemeral: true });
  try {
    const peerLamport = 999;
    const peerTimestamp = '2024-01-01T00:00:00.000Z';
    const peerId = uuidv7();
    const persisted = await repo.put({
      id: peerId,
      repo: 'github.com/foo/bar',
      topic: 't',
      kind: 'gotcha',
      title: 'from peer',
      body: 'this entry was written by another peer',
      lamport: peerLamport,
      last_modified_at: peerTimestamp,
    }, { fromSync: true });
    assert.equal(persisted.lamport, peerLamport, 'lamport must be the peer\'s, not nextLamport()');
    assert.equal(persisted.last_modified_at, peerTimestamp, 'last_modified_at must be the peer\'s');
  } finally {
    await repo.close();
  }
}));

test('Repository.put without fromSync stamps with local clock', withTmpHome(async () => {
  const repo = await openRepo({ ephemeral: true });
  try {
    const before = Date.now();
    const persisted = await repo.put({
      repo: 'github.com/foo/bar',
      topic: 't',
      kind: 'gotcha',
      title: 'fresh',
      body: 'a fresh write from this machine',
    });
    const after = Date.now();
    assert.ok(persisted.lamport > 0, 'lamport must be assigned by nextLamport()');
    const persistedTs = Date.parse(persisted.last_modified_at);
    assert.ok(persistedTs >= before && persistedTs <= after,
      `last_modified_at ${persistedTs} should be within [${before}, ${after}]`);
  } finally {
    await repo.close();
  }
}));

test('idempotent fromSync hit upgrades lamport when incoming > existing', withTmpHome(async () => {
  const repo = await openRepo({ ephemeral: true });
  try {
    const id = uuidv7();
    const seed = await repo.put({
      id,
      repo: 'github.com/foo/bar',
      topic: 't',
      kind: 'gotcha',
      title: 'seed',
      body: 'identical body',
      lamport: 10,
      last_modified_at: '2024-01-01T00:00:00.000Z',
    }, { fromSync: true });
    assert.equal(seed.lamport, 10);

    // Same content under same coordinates from a peer with HIGHER lamport.
    // Idempotency hit, but lamport must converge upward.
    const reconciled = await repo.put({
      id: uuidv7(), // different id intentionally — content_hash hits
      repo: 'github.com/foo/bar',
      topic: 't',
      kind: 'gotcha',
      title: 'seed',
      body: 'identical body',
      lamport: 50,
      last_modified_at: '2024-02-01T00:00:00.000Z',
    }, { fromSync: true });
    assert.equal(reconciled.lamport, 50, 'lamport must converge upward on idempotent sync hit');
  } finally {
    await repo.close();
  }
}));

test('idempotent fromSync hit does NOT regress lamport when incoming < existing', withTmpHome(async () => {
  const repo = await openRepo({ ephemeral: true });
  try {
    await repo.put({
      id: uuidv7(),
      repo: 'github.com/foo/bar',
      topic: 't',
      kind: 'gotcha',
      title: 'seed',
      body: 'body',
      lamport: 100,
      last_modified_at: '2024-06-01T00:00:00.000Z',
    }, { fromSync: true });

    // Same content from a peer with LOWER lamport — must not regress.
    const after = await repo.put({
      id: uuidv7(),
      repo: 'github.com/foo/bar',
      topic: 't',
      kind: 'gotcha',
      title: 'seed',
      body: 'body',
      lamport: 5,
      last_modified_at: '2024-01-01T00:00:00.000Z',
    }, { fromSync: true });
    assert.equal(after.lamport, 100, 'lamport must NOT regress to a lower peer value');
  } finally {
    await repo.close();
  }
}));
