// Stage 3 — rerank.
//
// Score every candidate with weighted features:
//   - BM25 score (normalized to [0,1] across the candidate set)
//   - Dense similarity (cosine, already in [0,1])
//   - Recency decay (exp decay over days since last_used_at or last_modified_at)
//   - Confidence (entry.confidence in [0,1])
//   - Kind weight (KIND_WEIGHT[kind])
//   - Author trust (your own writes rank slightly higher; configurable)
//
// Tunable weights live in a single object so the gold-set test can sweep
// them and we can publish stable numbers.

import { KIND_WEIGHT } from '../schema/kinds.mjs';
import { approximateTokenCount } from '../schema/validators.mjs';

export const DEFAULT_WEIGHTS = Object.freeze({
  bm25: 1.0,
  dense: 1.0,
  recency: 0.4,
  confidence: 0.6,
  kind: 0.5,
  authorSelf: 0.2,
  warningPenalty: 0.4,
});

/**
 * Combine BM25 + dense candidate sets and produce a reranked list of {entry, score}.
 *
 * @param {{bm25: Array<{entry, bm25}>, dense: Array<{entry, sim}>}} candidates
 * @param {{ weights?: object, selfUser?: string, now?: number, queryTokens?: Set<string> }} opts
 */
export function rerank(candidates, opts = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const now = opts.now ?? Date.now();
  const selfUser = opts.selfUser || '';

  // Merge candidates by id, taking max bm25 / max dense from each.
  const byId = new Map();
  for (const c of candidates.bm25 || []) {
    byId.set(c.entry.id, { entry: c.entry, bm25: c.bm25 || 0, dense: 0 });
  }
  for (const c of candidates.dense || []) {
    const v = byId.get(c.entry.id);
    if (v) v.dense = Math.max(v.dense, c.sim || 0);
    else byId.set(c.entry.id, { entry: c.entry, bm25: 0, dense: c.sim || 0 });
  }

  const merged = Array.from(byId.values());
  if (merged.length === 0) return [];

  // Normalize BM25 across candidate set.
  const maxBm25 = merged.reduce((m, x) => Math.max(m, x.bm25), 0) || 1;
  for (const m of merged) m.bm25Norm = m.bm25 / maxBm25;

  for (const m of merged) {
    const e = m.entry;
    const recency = recencyScore(e, now);
    const kindWeight = KIND_WEIGHT[e.kind] ?? 1.0;
    const conf = Math.max(0, Math.min(1, Number(e.confidence) || 0));
    const authorSelf = e.author?.user && e.author.user === selfUser ? 1 : 0;
    const warnPenalty = (e.warnings?.length || 0) > 0 ? 1 : 0;

    m.score =
      w.bm25 * m.bm25Norm +
      w.dense * m.dense +
      w.recency * recency +
      w.confidence * conf +
      w.kind * (kindWeight - 1.0) + // KIND_WEIGHT centered on 1.0
      w.authorSelf * authorSelf -
      w.warningPenalty * warnPenalty;
  }

  merged.sort((a, b) => b.score - a.score);
  return merged;
}

function recencyScore(entry, now) {
  const t = entry.last_used_at || entry.last_modified_at || entry.created_at;
  if (!t) return 0;
  const days = Math.max(0, (now - Date.parse(t)) / 86400_000);
  // exp(-days/halfLife) gives 1.0 at age 0 and ~0.5 at halfLife.
  // 60-day half-life works well across the gold set.
  return Math.exp(-days / 60);
}

/**
 * Stage 4 — token budget cap. Walk in score order and admit entries until
 * the token budget runs out.
 *
 * @param {Array<{entry, score}>} ranked
 * @param {{ tokenBudget?: number }} opts
 */
export function applyTokenBudget(ranked, opts = {}) {
  const budget = opts.tokenBudget ?? 2000;
  const out = [];
  let used = 0;
  for (const r of ranked) {
    const cost = approximateTokenCount(r.entry.title) + approximateTokenCount(r.entry.body);
    if (used + cost > budget && out.length > 0) break;
    out.push(r);
    used += cost;
    if (used >= budget) break;
  }
  return { results: out, tokensUsed: used };
}
