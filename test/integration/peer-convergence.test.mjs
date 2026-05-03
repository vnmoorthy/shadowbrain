// Regression test for codex-fallback finding #3
//
// Two peers writing identical content under the same coordinates land on
// different ids. The idempotency check in Repository.put short-circuits
// the second peer's write, returning the local row.
//
// PRE-FIX: returned the local row's lamport unchanged. Re-pushed locally
// at the OLD lamport. Pull-push cycles re-triggered the dance forever and
// `last_modified_at` got rewritten on every loop with no convergence.
//
// POST-FIX (fix #1's idempotency-with-fromSync branch): when the incoming
// lamport > existing lamport, the existing row's lamport upgrades. After
// at most two round-trips, both peers stabilize at the same lamport and
// subsequent pulls become idempotent no-ops.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRepo } from '../../src/storage/repository.mjs';
import { uuidv7 } from '../../src/schema/entry.mjs';
import { withTmpHome } from '../_helpers/tmp-home.mjs';

test('peer convergence: lamport stabilizes after 2 sync round-trips', withTmpHome(async () => {
  // Simulate peer A: writes entry locally.
  const peerA = await openRepo({ ephemeral: true });
  let aId, aLamport;
  try {
    const aEntry = await peerA.put({
      repo: 'github.com/foo/bar',
      topic: 'tooling',
      kind: 'gotcha',
      title: 'pnpm not npm',
      body: 'this project uses pnpm',
    });
    aId = aEntry.id;
    aLamport = Number(aEntry.lamport);
    assert.ok(aId);
    assert.ok(aLamport > 0);
  } finally {
    await peerA.close();
  }

  // Simulate peer B: writes IDENTICAL content with a different id and a
  // higher lamport (because B's local clock advanced more).
  const peerB = await openRepo({ ephemeral: true });
  let bId, bLamport;
  try {
    const bEntry = await peerB.put({
      repo: 'github.com/foo/bar',
      topic: 'tooling',
      kind: 'gotcha',
      title: 'pnpm not npm',
      body: 'this project uses pnpm',
    });
    bId = bEntry.id;
    bLamport = Number(bEntry.lamport);
    // Force B's lamport higher.
    if (bLamport <= aLamport) bLamport = aLamport + 5;
    assert.notEqual(aId, bId);
  } finally {
    await peerB.close();
  }

  // Round trip 1: peer A pulls peer B's entry. The existing row has
  // lamport = aLamport; the incoming has lamport = bLamport > aLamport.
  // The idempotency-hit branch must upgrade existing.lamport to bLamport.
  const peerAReimport = await openRepo({ ephemeral: true });
  try {
    // Replay A's original write to seed the in-process Lamport state.
    await peerAReimport.put({
      id: aId,
      repo: 'github.com/foo/bar', topic: 'tooling', kind: 'gotcha',
      title: 'pnpm not npm', body: 'this project uses pnpm',
      lamport: aLamport, last_modified_at: '2024-01-01T00:00:00.000Z',
    }, { fromSync: true });
    // Now pull B's entry. Idempotency hit, fromSync, incoming.lamport > existing.lamport.
    await peerAReimport.put({
      id: bId,
      repo: 'github.com/foo/bar', topic: 'tooling', kind: 'gotcha',
      title: 'pnpm not npm', body: 'this project uses pnpm',
      lamport: bLamport, last_modified_at: '2024-01-02T00:00:00.000Z',
    }, { fromSync: true });

    const reconciled = await peerAReimport.get(aId);
    assert.equal(reconciled.lamport, bLamport,
      `peer A's row should converge to peer B's lamport after pull. Got ${reconciled.lamport}, expected ${bLamport}`);
  } finally {
    await peerAReimport.close();
  }

  // Round trip 2: peer A pushes the (now bLamport-stamped) row back. Peer
  // B receives it and runs the same dance. Idempotency hit, equal lamport,
  // no update. Steady state.
  const peerBReimport = await openRepo({ ephemeral: true });
  try {
    await peerBReimport.put({
      id: bId,
      repo: 'github.com/foo/bar', topic: 'tooling', kind: 'gotcha',
      title: 'pnpm not npm', body: 'this project uses pnpm',
      lamport: bLamport, last_modified_at: '2024-01-02T00:00:00.000Z',
    }, { fromSync: true });
    const beforePullA = await peerBReimport.get(bId);

    // Pull peer A's pushed-back entry (now at bLamport).
    await peerBReimport.put({
      id: aId,
      repo: 'github.com/foo/bar', topic: 'tooling', kind: 'gotcha',
      title: 'pnpm not npm', body: 'this project uses pnpm',
      lamport: bLamport, last_modified_at: '2024-01-02T00:00:00.000Z',
    }, { fromSync: true });
    const afterPullA = await peerBReimport.get(bId);
    assert.equal(afterPullA.lamport, beforePullA.lamport,
      `equal lamport pull must not change peer B's row — steady state reached`);
    assert.equal(afterPullA.last_modified_at, beforePullA.last_modified_at,
      `equal lamport pull must not bump last_modified_at — pre-fix bug regression check`);
  } finally {
    await peerBReimport.close();
  }
}));
