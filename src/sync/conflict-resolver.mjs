// Conflict resolver — Lamport-timestamp last-write-wins with structured
// merge for arrays.
//
// Two engineers offline both write to the same (repo, scope, topic, kind).
// They sync. We pick one as canonical:
//
//   1. Higher lamport wins.
//   2. If equal lamports (clock-skew tie), last_modified_at wins.
//   3. If equal again (impossible-but-defensive), order by author.machine
//      lex-ascending so the choice is deterministic.
//
// For array-shaped fields (context.tags, context.files, context.symbols,
// context.deps, supersedes, warnings) we union both versions and dedupe
// by content. Lossless merge — the canonical version's scalar fields plus
// the union of arrays.
//
// Every resolution is logged to ~/.shadowbrain/conflicts.jsonl with both
// versions so a user can `shadowbrain conflicts review` and audit.

const ARRAY_FIELDS = ['supersedes', 'warnings'];
const CONTEXT_ARRAY_FIELDS = ['files', 'symbols', 'deps', 'tags'];

/**
 * @param {object} mine - the existing entry on this machine
 * @param {object} theirs - the incoming entry from sync
 * @returns {{ resolution: 'mine'|'theirs'|'merge', merged: object, conflict?: object }}
 */
export function resolveConflict(mine, theirs) {
  if (!mine) return { resolution: 'theirs', merged: theirs };
  if (!theirs) return { resolution: 'mine', merged: mine };
  if (mine.id !== theirs.id) {
    throw new Error(`refusing to merge entries with different ids: ${mine.id} vs ${theirs.id}`);
  }

  const mineLamport = Number(mine.lamport || 0);
  const theirsLamport = Number(theirs.lamport || 0);
  const winner = pickWinner(mine, theirs, mineLamport, theirsLamport);

  // Last-write-wins alone is enough when no array data would be lost. We
  // check arrays whether or not lamports differ — equal-lamport ties also
  // get this fast path when tags/files etc. match.
  if (!arraysWouldBeLost(mine, theirs)) {
    return {
      resolution: winner === mine ? 'mine' : 'theirs',
      merged: winner,
    };
  }

  // Otherwise: structured merge. Take all scalar fields from the winner,
  // but union arrays.
  const merged = { ...winner };
  for (const f of ARRAY_FIELDS) {
    merged[f] = unionDedupe(mine[f] || [], theirs[f] || []);
  }
  if (mine.context || theirs.context) {
    merged.context = { ...(winner.context || {}) };
    for (const f of CONTEXT_ARRAY_FIELDS) {
      merged.context[f] = unionDedupe(mine.context?.[f] || [], theirs.context?.[f] || []);
    }
  }
  // Preserve the higher use_count and the more-recent last_used_at.
  merged.use_count = Math.max(Number(mine.use_count || 0), Number(theirs.use_count || 0));
  merged.last_used_at = pickRecent(mine.last_used_at, theirs.last_used_at);
  // Keep merged.lamport anchored to the max of the inputs — NOT bumped past.
  // Bumping causes order-dependent finals: a merge of low-lamport entries
  // ends up "higher" than a not-yet-merged entry with the highest original
  // lamport, so subsequent folds incorrectly favor the merged version.
  merged.lamport = Math.max(mineLamport, theirsLamport);

  const conflict = {
    entry_id: mine.id,
    mine,
    theirs,
    merged,
    resolution: { keep: winner === mine ? 'mine' : 'theirs', merged: true },
  };

  return { resolution: 'merge', merged, conflict };
}

function pickWinner(mine, theirs, ml, tl) {
  if (ml !== tl) return ml > tl ? mine : theirs;
  const md = Date.parse(mine.last_modified_at || mine.created_at || 0) || 0;
  const td = Date.parse(theirs.last_modified_at || theirs.created_at || 0) || 0;
  if (md !== td) return md > td ? mine : theirs;
  // deterministic: lex-min machine wins
  return (mine.author?.machine || '') <= (theirs.author?.machine || '') ? mine : theirs;
}

function arraysWouldBeLost(mine, theirs) {
  for (const f of ARRAY_FIELDS) {
    if (!sameSet(mine[f] || [], theirs[f] || [])) return true;
  }
  for (const f of CONTEXT_ARRAY_FIELDS) {
    if (!sameSet(mine.context?.[f] || [], theirs.context?.[f] || [])) return true;
  }
  return false;
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).slice().sort();
  const sb = b.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).slice().sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

function unionDedupe(a, b) {
  const seen = new Set();
  const out = [];
  for (const x of [...a, ...b]) {
    const k = typeof x === 'string' ? x : JSON.stringify(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function pickRecent(a, b) {
  const da = a ? Date.parse(a) : 0;
  const db = b ? Date.parse(b) : 0;
  if (!da && !db) return null;
  return da > db ? a : b;
}
