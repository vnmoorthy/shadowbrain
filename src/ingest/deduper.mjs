// Deduper — given a list of candidate entries, fold near-duplicates by
// content_hash, keeping the highest-confidence and most-recently-used one.

import { entryContentHash } from '../schema/entry.mjs';

export function dedupe(entries) {
  const byKey = new Map();
  for (const e of entries) {
    const h = entryContentHash(e);
    const existing = byKey.get(h);
    if (!existing) { byKey.set(h, e); continue; }
    if (e.confidence > existing.confidence) byKey.set(h, e);
    else if (
      e.confidence === existing.confidence &&
      tsValue(e.last_used_at) > tsValue(existing.last_used_at)
    ) {
      byKey.set(h, e);
    }
  }
  return Array.from(byKey.values());
}

function tsValue(t) {
  if (!t) return 0;
  return Date.parse(t) || 0;
}
