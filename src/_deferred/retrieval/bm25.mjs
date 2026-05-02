// In-memory BM25 — used as a fallback when the backend tsvector index is
// unavailable, and as a parallel scorer when reranking against an in-context
// candidate set. Backends with full-text support push the same scoring into
// the SQL layer; this implementation matches Lucene-style BM25 closely
// enough for our gold-set benchmarks.

const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;

const STOP = new Set([
  'the','a','an','and','or','of','to','in','on','for','is','are','was','were','be',
  'been','being','this','that','it','its','as','at','by','from','with','will','can',
  'could','should','would','does','do','did','have','has','had','i','you','he','she',
  'we','they','them','their','our','your','my','me','us','them','if','then','than',
]);

export function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t && t.length > 1 && !STOP.has(t));
}

/**
 * Build a BM25 index over (id, text) pairs.
 *   docs: { id: string, text: string }[]
 */
export function buildIndex(docs, opts = {}) {
  const k1 = opts.k1 ?? DEFAULT_K1;
  const b = opts.b ?? DEFAULT_B;

  const N = docs.length;
  const docTokens = docs.map((d) => tokenize(d.text));
  const docLens = docTokens.map((t) => t.length);
  const avgdl = docLens.reduce((s, l) => s + l, 0) / Math.max(1, N);

  const df = new Map();
  const tf = docs.map((_, i) => {
    const counts = new Map();
    for (const t of docTokens[i]) counts.set(t, (counts.get(t) || 0) + 1);
    for (const t of counts.keys()) df.set(t, (df.get(t) || 0) + 1);
    return counts;
  });

  const idf = new Map();
  for (const [t, n] of df) {
    idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }

  return {
    N, k1, b, avgdl, df, idf, tf, docs,
    docLens,
  };
}

/**
 * Score a query against the index. Returns parallel array of scores in
 * doc order. Higher is better; 0 means no match.
 */
export function score(index, query) {
  const qTokens = Array.from(new Set(tokenize(query)));
  const { k1, b, avgdl, idf, tf, docLens } = index;
  const scores = new Array(index.N).fill(0);
  for (const qt of qTokens) {
    const qIdf = idf.get(qt);
    if (!qIdf) continue;
    for (let i = 0; i < index.N; i++) {
      const f = tf[i].get(qt);
      if (!f) continue;
      const dl = docLens[i] || 1;
      const num = f * (k1 + 1);
      const denom = f + k1 * (1 - b + (b * dl) / avgdl);
      scores[i] += qIdf * (num / denom);
    }
  }
  return scores;
}

/**
 * Top-k convenience. Returns [{ doc, score }, ...] sorted desc.
 */
export function topK(index, query, k = 10) {
  const s = score(index, query);
  const ranked = index.docs.map((d, i) => ({ doc: d, score: s[i] }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked.filter((r) => r.score > 0).slice(0, k);
}
