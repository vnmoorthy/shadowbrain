# Protocol

The Entry shape and the retrieval ranking algorithm. Both are versioned; this document covers v0.5.

## Entry shape

```typescript
type EntryKind =
  | 'decision'      // architectural choice with reasoning
  | 'pattern'       // reusable approach the codebase prefers
  | 'anti_pattern'  // approach the codebase rejects
  | 'gotcha'        // non-obvious bug, foot-gun, or workaround
  | 'dead_end'      // approach tried and abandoned, with why
  | 'convention'    // naming, layout, style rule
  | 'integration'   // third-party service quirk
  | 'deployment'    // infra, env, CI/CD specific knowledge
  | 'glossary'      // term definition specific to this codebase
  | 'todo';         // explicit deferred work the team agreed to

interface Entry {
  id: string;                   // UUIDv7 — time-sortable
  repo: string;                 // canonical remote URL
  scope: string | null;         // path prefix for monorepos
  topic: string;                // short slug, e.g. "auth"
  kind: EntryKind;
  title: string;                // <= 200 chars
  body: string;                 // <= ~4000 tokens
  context: {
    files?: string[];
    symbols?: string[];
    deps?: string[];
    tags?: string[];
  };
  confidence: number;           // 0.0 to 1.0, decays without use
  author: {
    agent: string;              // "claude-code-2.1.119"
    user: string;               // git config user.email
    machine: string;            // hashed hostname
  };
  created_at: string;           // ISO 8601
  last_modified_at: string;
  last_used_at: string | null;
  use_count: number;
  supersedes: string[];         // ids replaced by this entry
  superseded_by: string | null;
  warnings: string[];           // detector-flagged or manual
  embedding_v1?: number[];      // 384-dim
  embedding_v2?: number[];      // reserved
  lamport: number;              // monotonic write counter
  deleted: boolean;
}
```

## Identity and idempotency

- `id` is a UUIDv7 — first 48 bits encode the wall-clock millisecond, rest is random.
- `content_hash` (not exposed in the public Entry shape but stored) is sha256 over `(repo, scope, topic, kind, title.trim(), body.trim())`. Used for write idempotency.
- Repeated `memory_put` of the same content under the same coordinates is a no-op that returns the existing id.

## Lamport timestamps

Each write bumps a per-machine monotonic counter. The pair `(wall_clock, lamport)` is the canonical ordering used by the conflict resolver. Wall clock breaks ties when lamports are equal across machines (clock skew survival).

## Retrieval — the four stages

### Stage 1: candidate generation

- **BM25** over `(title × 3, body, topic, tags)`. The `title × 3` repetition is a soft boost — titles dominate when query terms appear there. Title is the headline; matching the headline correlates strongly with the user's intent.
- **Dense vector retrieval** via `bge-small-en-v1.5` (384 dims). Optional remote embedder (OpenAI / Voyage / Cohere) via env var.
- Top-50 from each, deduplicated by entry id.

### Stage 2: structural filters

- Drop entries from other repos unless tagged `cross-repo`.
- Drop scope mismatches (monorepo) unless tagged `shared`.
- Drop entries past their kind-specific freshness threshold (`KIND_FRESHNESS_DAYS` in `src/schema/kinds.mjs`):

| Kind | Days |
|---|---|
| decision | 730 |
| glossary | 730 |
| pattern, anti_pattern, gotcha, dead_end, convention | 365 |
| integration | 180 |
| deployment | 90 |
| todo | 60 |

- Drop entries already shown to this agent in this session.

### Stage 3: rerank

Score = weighted sum of:

| Feature | Default Weight |
|---|---|
| BM25 (normalized to [0,1] across candidate set) | 1.0 |
| Dense cosine similarity | 1.0 |
| Recency decay — `exp(-days_since_touched / 60)` | 0.4 |
| Confidence (entry.confidence in [0,1]) | 0.6 |
| Kind weight (`KIND_WEIGHT - 1.0`, see below) | 0.5 |
| Author self (1 if author.user matches caller) | 0.2 |
| Warning penalty (1 if any warnings) | -0.4 |

Kind weights (from `src/schema/kinds.mjs`):

| Kind | Weight |
|---|---|
| gotcha | 1.20 |
| anti_pattern | 1.15 |
| dead_end | 1.10 |
| decision | 1.08 |
| integration, deployment | 1.05 |
| convention | 1.02 |
| pattern | 1.00 |
| glossary | 0.95 |
| todo | 0.90 |

Rationale: a `gotcha` (non-obvious bug, footgun) outranks a `pattern` for the same query because the agent is more likely to *need* the gotcha right now. A `todo` is deprioritized because it's reference, not action.

### Stage 4: token budget cap

Walk reranked list in score order. Admit entries until cumulative token cost exceeds the budget. Default `token_budget = 2000`. Configurable per-call.

Rationale: the agent's context window is precious. Five high-relevance entries beat ten so-so entries.

## Precision@5 evaluation

A 1000-entry corpus (60 hand-written seeds × ~16 perturbations each) and 49 hand-labeled queries live in `test/fixtures/`. Each query has a `relevant: ['seed-N']` annotation; we expand seed-N into all perturbation ids of that seed.

Current numbers (from `test:gold`):

| Embedder | Precision@5 |
|---|---|
| Hash (built-in fallback) | 0.959 |
| `bge-small-en-v1.5` (local) | tracked in CI |
| OpenAI `text-embedding-3-small` | tracked in CI |

CI gates merges at `precision@5 >= 0.90`.

## Conflict resolution

Two writers, same id, different content:

1. Higher `lamport` wins.
2. Equal lamports → higher `last_modified_at` wins.
3. Equal both → lex-min `author.machine` wins (deterministic).

If array fields differ across versions (e.g. tags, files, symbols, supersedes, warnings), we **union-merge** them and keep the winner's scalars. The merged `lamport` stays anchored to `max(mine, theirs)` — bumping past it would make merged results incorrectly outrank later, equally-original writes. Every merge is logged to `~/.shadowbrain/conflicts.jsonl` for `shadowbrain conflicts review`.

## Schema versioning

`sb_meta.schema_version` tracks the applied migration version. The migrator (`src/storage/migrations.mjs`) is forward-only and idempotent — `ADD COLUMN IF NOT EXISTS`, etc. v0.5 ships at version 5.

A future v0.6 that adds a column simply:

1. Bumps `TARGET_SCHEMA_VERSION` to 6.
2. Appends a step to `MIGRATIONS`.

`shadowbrain serve` refuses to start against a DB whose `schema_version` is *higher* than the binary's `TARGET_SCHEMA_VERSION` — the user is told to upgrade or `shadowbrain reset`.

## MCP wire format

All six tools follow the same envelope:

```json
{ "ok": true, "...": "..." }
```

or

```json
{ "ok": false, "error": { "code": "...", "message": "...", "hint": "...", "docs": "..." } }
```

Empty result is **never** an error: `{ "ok": true, "results": [] }`.
