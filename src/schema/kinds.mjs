// Entry kinds. Order matters: it's the default rerank weight when two
// entries tie on retrieval score. `gotcha` outranks `pattern` for the same
// query, per the spec — that's encoded here.

export const ENTRY_KINDS = Object.freeze([
  'decision',
  'pattern',
  'anti_pattern',
  'gotcha',
  'dead_end',
  'convention',
  'integration',
  'deployment',
  'glossary',
  'todo',
]);

// Kind weights for the reranker. Higher = boosted in tied retrieval.
// Calibrated against the gold set in test/integration/retrieval-gold.test.mjs.
// Tweak with care; expected to drift as the gold set grows.
export const KIND_WEIGHT = Object.freeze({
  gotcha: 1.20,
  anti_pattern: 1.15,
  dead_end: 1.10,
  decision: 1.08,
  integration: 1.05,
  deployment: 1.05,
  convention: 1.02,
  pattern: 1.00,
  glossary: 0.95,
  todo: 0.90,
});

export function isEntryKind(s) {
  return ENTRY_KINDS.includes(s);
}

// Per-kind freshness threshold in days. Decisions stay fresh forever; todos
// stale fast. Used in the structural-filter stage of the retriever.
export const KIND_FRESHNESS_DAYS = Object.freeze({
  decision: 730,
  pattern: 365,
  anti_pattern: 365,
  gotcha: 365,
  dead_end: 365,
  convention: 365,
  integration: 180,
  deployment: 90,
  glossary: 730,
  todo: 60,
});
