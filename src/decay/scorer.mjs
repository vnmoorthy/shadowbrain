// Decay scorer.
//
// Confidence score in [0, 1] that ages every day an entry isn't retrieved.
// The job runs nightly (or on-demand `shadowbrain decay`). The reranker
// already weights confidence, so a stale entry naturally drops in rank
// before being pruned.
//
// Decay function:
//
//   confidence(t) = confidence(t-1) * exp(-rate * days_since_last_use)
//
// `rate` defaults to 0.005 — a fresh entry takes ~140 days to halve if
// never retrieved. A decay-resistant entry that's used weekly stays near 1.

const DEFAULT_RATE = 0.005;

/**
 * Apply decay to one entry. Returns the new confidence (does not mutate).
 */
export function decayConfidence(entry, { rate = DEFAULT_RATE, now = Date.now() } = {}) {
  const lastTouched = entry.last_used_at || entry.last_modified_at || entry.created_at;
  if (!lastTouched) return entry.confidence ?? 0.7;
  const days = Math.max(0, (now - Date.parse(lastTouched)) / 86400_000);
  const factor = Math.exp(-rate * days);
  const c = (entry.confidence ?? 0.7) * factor;
  // Boost slightly if recently used many times — counters the decay for
  // entries the team genuinely relies on.
  const useBoost = entry.use_count > 0 ? Math.min(0.2, entry.use_count * 0.01) : 0;
  return Math.max(0, Math.min(1, c + useBoost));
}

/**
 * Filter — return only the entries whose new confidence falls below
 * `threshold`. Useful for `shadowbrain decay --dry-run`.
 */
export function pruneBelow(entries, threshold = 0.05, opts = {}) {
  return entries.filter((e) => decayConfidence(e, opts) < threshold);
}
