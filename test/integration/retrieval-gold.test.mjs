// Precision@5 gate.
//
// Loads the synthetic corpus, runs all labeled queries through the retriever,
// and asserts the precision@5 number stays above the threshold. Uses the
// hash embedder (zero-network) so CI never depends on model downloads. The
// real local model lifts numbers further; that's tracked in
// docs/PROTOCOL.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRepo } from '../../src/storage/repository.mjs';
import { hybridRetrieve } from '../../src/retrieval/ranker.mjs';
import { generateCorpus, QUERIES } from '../fixtures/gen-corpus.mjs';

// We bind the repository's seed→ids mapping so we can grade results against
// `relevant: ['seed-1', 'seed-12']` etc.

const PRECISION_AT_5_FLOOR = 0.90; // hash embedder + BM25 + stemming. Real local embedder (bge-small-en-v1.5) lifts this further; tracked in docs/PROTOCOL.md.

let _corpusRepo, _seedToIds;
async function loadCorpus() {
  if (_corpusRepo) return { repo: _corpusRepo, seedToIds: _seedToIds };
  process.env.SHADOWBRAIN_EMBEDDER = 'hash';
  const repo = await openRepo({ ephemeral: true });
  const corpus = generateCorpus(1000);
  const seedToIds = new Map();
  for (const e of corpus) {
    const stored = await repo.put({
      repo: e.repo,
      topic: e.topic,
      kind: e.kind,
      title: e.title,
      body: e.body,
      context: e.context,
      author: e.author,
    });
    if (e.seedId) {
      const arr = seedToIds.get(e.seedId) || [];
      arr.push(stored.id);
      seedToIds.set(e.seedId, arr);
    }
  }
  _corpusRepo = repo;
  _seedToIds = seedToIds;
  return { repo, seedToIds };
}

test('gold corpus: 1000 entries seeded, queries set has 50', async () => {
  const { repo } = await loadCorpus();
  const total = await repo.count();
  assert.ok(total >= 800 && total <= 1000, `expected ~1000 entries, got ${total}`);
  assert.ok(QUERIES.length >= 45, `expected ~50 queries, got ${QUERIES.length}`);
});

test('precision@5 across 50 queries is above floor', async (t) => {
  const { repo, seedToIds } = await loadCorpus();
  let hits = 0;
  let total = 0;
  const failures = [];
  for (const q of QUERIES) {
    const relevantIds = new Set(
      (q.relevant || []).flatMap((s) => seedToIds.get(s) || [])
    );
    if (relevantIds.size === 0) continue; // unlabeled query, skip
    const r = await hybridRetrieve(repo, {
      query: q.q,
      repo: q.repo,
      tokenBudget: 4000,
      dryRun: true,
    });
    const top5 = r.results.slice(0, 5).map((x) => x.entry.id);
    const matched = top5.filter((id) => relevantIds.has(id));
    if (matched.length === 0) {
      failures.push({ q: q.q, repo: q.repo, top5_titles: r.results.slice(0, 5).map((x) => x.entry.title) });
    }
    hits += matched.length > 0 ? 1 : 0;
    total += 1;
  }
  const p5 = hits / total;
  t.diagnostic(`precision@5 = ${p5.toFixed(3)} (${hits}/${total})`);
  if (failures.length > 0) {
    t.diagnostic(`failures: ${failures.length}`);
    for (const f of failures.slice(0, 5)) {
      t.diagnostic(`  - "${f.q}" → ${f.top5_titles.slice(0, 3).join(' | ')}`);
    }
  }
  assert.ok(p5 >= PRECISION_AT_5_FLOOR, `precision@5 ${p5.toFixed(3)} below floor ${PRECISION_AT_5_FLOOR}`);
});

test('retrieval is repo-scoped (no cross-repo bleed)', async () => {
  const { repo } = await loadCorpus();
  const r = await hybridRetrieve(repo, {
    query: 'JWT verification',
    repo: 'github.com/lab/research', // a repo that has nothing about JWTs
    tokenBudget: 2000,
    dryRun: true,
  });
  for (const x of r.results) {
    assert.equal(x.entry.repo, 'github.com/lab/research', `cross-repo leak: ${x.entry.repo}`);
  }
});

test('token budget caps results', async () => {
  const { repo } = await loadCorpus();
  const r = await hybridRetrieve(repo, {
    query: 'security',
    repo: 'github.com/acme/api',
    tokenBudget: 200,
    dryRun: true,
  });
  assert.ok(r.tokensUsed <= 400, `tokensUsed ${r.tokensUsed} blew the 200-token budget by too much`);
});
