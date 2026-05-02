// Stage 2 — structural filters for the retriever.
//
// Drop entries from other repos (unless cross-referenced), entries past
// their kind-specific freshness threshold, and entries already shown to
// the agent in this session.

import { KIND_FRESHNESS_DAYS } from '../schema/kinds.mjs';

/**
 * Filter candidates per spec §3.1 stage 2.
 *
 * @param {Array} candidates - [{ entry, ... }]
 * @param {{ repo?: string, scope?: string, seenIds?: Set<string>, now?: number, allowCrossRepo?: boolean }} ctx
 */
export function structuralFilter(candidates, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const seen = ctx.seenIds || new Set();
  const out = [];
  for (const c of candidates) {
    const e = c.entry;
    if (!e) continue;
    if (e.deleted) continue;
    if (seen.has(e.id)) continue;
    if (ctx.repo && e.repo !== ctx.repo && !ctx.allowCrossRepo) {
      // allow cross-repo only if explicitly tagged as such
      const tags = e.context?.tags || [];
      if (!tags.includes('cross-repo')) continue;
    }
    if (ctx.scope != null && e.scope != null && e.scope !== ctx.scope) {
      // monorepo: drop entries from other packages unless tagged 'shared'
      const tags = e.context?.tags || [];
      if (!tags.includes('shared')) continue;
    }
    if (!withinFreshness(e, now)) continue;
    out.push(c);
  }
  return out;
}

export function withinFreshness(entry, now = Date.now()) {
  const days = KIND_FRESHNESS_DAYS[entry.kind] ?? 365;
  const lastTouched = entry.last_used_at || entry.last_modified_at || entry.created_at;
  if (!lastTouched) return true;
  const ageDays = (now - Date.parse(lastTouched)) / 86400_000;
  return ageDays <= days;
}
