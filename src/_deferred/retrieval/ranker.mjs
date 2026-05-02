// Hybrid retriever — the load-bearing piece of Shadowbrain.
//
// Pipeline (per spec §3.1):
//   1. Candidate generation: top-50 BM25 + top-50 dense, dedupe.
//   2. Structural filters: drop wrong-repo, stale, already-seen.
//   3. Rerank: weighted feature combination.
//   4. Budget cap: top-N by token count, default 2000 tokens.

import { embedOne } from './embedder.mjs';
import { structuralFilter } from './filters.mjs';
import { rerank, applyTokenBudget, DEFAULT_WEIGHTS } from './reranker.mjs';

/**
 * @param {object} repo - Repository instance.
 * @param {object} q - { query, repo, scope, kind, seenIds, tokenBudget, weights, selfUser, k }
 */
export async function hybridRetrieve(repo, q) {
  const k = q.k ?? 50;
  // 1. candidate gen — both stages run in parallel.
  const queryVec = q.queryEmbedding ?? (await embedOne(q.query || ''));
  const [bm25, dense] = await Promise.all([
    repo.candidatesBM25({ query: q.query || '', repo: q.repo, scope: q.scope, kind: q.kind, limit: k }),
    repo.candidatesDense({ embedding: queryVec, repo: q.repo, scope: q.scope, kind: q.kind, limit: k }),
  ]);

  // 2. structural filter — applied to the union.
  const merged = mergeCandidates(bm25, dense);
  const filtered = structuralFilter(merged, {
    repo: q.repo,
    scope: q.scope,
    seenIds: q.seenIds || new Set(),
    allowCrossRepo: !!q.allowCrossRepo,
  });

  // Rebuild bm25/dense subsets restricted to filtered.
  const filteredIds = new Set(filtered.map((c) => c.entry.id));
  const bm25F = bm25.filter((c) => filteredIds.has(c.entry.id));
  const denseF = dense.filter((c) => filteredIds.has(c.entry.id));

  // 3. rerank.
  const ranked = rerank({ bm25: bm25F, dense: denseF }, {
    weights: q.weights ?? DEFAULT_WEIGHTS,
    selfUser: q.selfUser,
    now: q.now,
  });

  // 4. budget cap.
  const { results, tokensUsed } = applyTokenBudget(ranked, { tokenBudget: q.tokenBudget ?? 2000 });

  // Side effect: bump last_used_at + use_count for retrieved entries.
  // This signal feeds into decay.
  if (results.length > 0 && !q.dryRun) {
    repo.markUsedBatch(results.map((r) => r.entry.id)).catch(() => {});
  }

  return {
    results: results.map((r) => ({ entry: r.entry, score: r.score, bm25: r.bm25, dense: r.dense })),
    tokensUsed,
    candidateCount: filtered.length,
  };
}

function mergeCandidates(bm25, dense) {
  const map = new Map();
  for (const c of bm25) {
    if (!map.has(c.entry.id)) map.set(c.entry.id, { entry: c.entry });
  }
  for (const c of dense) {
    if (!map.has(c.entry.id)) map.set(c.entry.id, { entry: c.entry });
  }
  return Array.from(map.values());
}
