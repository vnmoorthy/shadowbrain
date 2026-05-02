// Decay job — apply scorer to every live entry, prune below threshold,
// and prune aged-out tombstones.
//
// Three phases:
//   1. Score: compute new confidence per entry
//   2. Apply: write all new confidences in a single transaction
//   3. Prune: soft-delete entries below threshold; hard-delete tombstones
//      older than TOMBSTONE_DAYS

import { decayConfidence } from './scorer.mjs';

export async function runDecayJob(repo, opts = {}) {
  const rate = Number(opts.rate ?? 0.005);
  const threshold = Number(opts.threshold ?? 0.05);
  const dryRun = !!opts.dryRun;

  const entries = await repo.list({ includeDeleted: false });
  const deltas = [];
  for (const e of entries) {
    const newC = decayConfidence(e, { rate });
    if (Math.abs(newC - (e.confidence ?? 0)) > 0.001) {
      deltas.push({ id: e.id, newConfidence: newC });
    }
  }

  let pruned = 0;
  let tombstoned = 0;
  if (!dryRun) {
    if (deltas.length > 0) await repo.applyConfidence(deltas);
    pruned = await repo.prune(threshold);
    tombstoned = await repo.pruneTombstones();
  } else {
    pruned = entries.filter((e) => decayConfidence(e, { rate }) < threshold).length;
  }

  return { decayed: deltas.length, pruned, tombstoned };
}
