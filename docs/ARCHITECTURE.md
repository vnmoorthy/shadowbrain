# Architecture

Shadowbrain is a **shared, queryable memory layer** that any MCP-compatible coding agent can read from and write to, scoped per-repo with explicit trust tiers.

## The five layers

```
┌──────────────────────────────────────────────────────────┐
│  Layer 1: MCP Server                                     │
│  src/mcp/server.mjs                                      │
│  Six tools: search, put, get, list, forget, audit        │
│  stdio transport (Claude Code / Cursor / Codex / ...)    │
└──────────────────────────────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────┐
│  Layer 2: Storage Backend                                │
│  src/storage/{pglite,postgres,repository}.mjs            │
│  Pluggable: PGLite (default) or Postgres 14+             │
│  Single-writer flock at ~/.shadowbrain/serve.lock        │
└──────────────────────────────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────┐
│  Layer 3: Sync                                           │
│  src/sync/{git-mirror,conflict-resolver,daemon}.mjs      │
│  isomorphic-git push/pull to a private git repo          │
│  Lamport-timestamp last-write-wins, structured array merge│
└──────────────────────────────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────┐
│  Layer 4: Trust + Scope                                  │
│  src/trust/{policy,store,prompt,scope}.mjs               │
│  Three tiers per remote: read-write, read-only, deny     │
│  Sticky decisions in ~/.shadowbrain/trust.yaml           │
│  Monorepo path-prefix scoping                            │
└──────────────────────────────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────┐
│  Layer 5: Decay + Forgetting                             │
│  src/decay/{scorer,job}.mjs                              │
│  Confidence ages without use; below threshold → tombstone│
│  Tombstones live 30d then hard-delete                    │
└──────────────────────────────────────────────────────────┘
```

Plus three cross-cutting concerns:

- **Retrieval** (`src/retrieval/`) — BM25 + dense embeddings + reranker + token budget cap.
- **Ingest** (`src/ingest/`) — secret scanner, PII scanner, normalizer, deduper, adversarial-content enricher.
- **Schema** (`src/schema/`) — canonical Entry shape, kinds taxonomy, Zod validators, UUIDv7 + content_hash + Lamport.

## Data flow — write

1. Agent calls `memory_put({ title, body, ... })` over MCP.
2. MCP server receives the call, normalizes input.
3. **Trust check:** is this repo writable for this user? (If unknown, prompt; if `deny`, reject.)
4. **Body size guard:** ≤ 4000 tokens.
5. **Secret scan:** AWS keys, GH PATs, OpenAI/Anthropic, JWTs, PEM, etc. Block on detection.
6. **PII scan:** SSNs block by default; emails/phones warn (configurable per-repo).
7. **Adversarial detect:** code patterns (`eval`, `curl|bash`, `--break-system-packages`) attach warnings.
8. **Idempotency:** content_hash collision under (repo, scope, topic, kind) → return existing id.
9. Repository writes the row + audit-log entry in one transaction.
10. Lamport counter bumps; sync layer (if running) picks it up on next tick.

## Data flow — read

1. Agent calls `memory_search({ query, repo?, ... })` over MCP.
2. MCP server detects the repo if not provided (canonical git remote URL).
3. **Trust check:** read access to this repo? (Unknown repos default to read-allowed for discovery.)
4. **Stage 1 — candidate generation:** in-process BM25 over (title × 3, body, topic, tags) for top-50 lexical hits + dense vector similarity for top-50 semantic hits, deduplicated.
5. **Stage 2 — structural filters:** drop other-repo entries unless `cross-repo` tagged; drop scope mismatches unless `shared`; drop entries past kind-specific freshness; drop entries already shown this session.
6. **Stage 3 — rerank:** weighted score over (BM25 normalized, dense similarity, recency decay, confidence, kind weight, author trust, warning penalty).
7. **Stage 4 — token budget cap:** walk in score order, admit until budget exhausted (default 2000 tokens).
8. Each entry's body is wrapped in `<shadowbrain-entry>...</shadowbrain-entry>` delimiters and the tool description tells the agent it's user data, not instructions.
9. Side effect: `last_used_at` and `use_count` bump for retrieved entries (feeds decay).

## Storage schema

A single table, expanded across migrations 1-5:

```sql
CREATE TABLE sb_v01_entries (
  id                TEXT PRIMARY KEY,    -- UUIDv7
  repo              TEXT NOT NULL,
  scope             TEXT,                -- monorepo path prefix
  topic             TEXT NOT NULL,       -- 'auth', 'billing', ...
  kind              TEXT NOT NULL,       -- decision | pattern | ...
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  text              TEXT NOT NULL,       -- v0.1 compat mirror of body
  ctx_files         JSONB,
  ctx_symbols       JSONB,
  ctx_deps          JSONB,
  tags              JSONB,
  confidence        REAL,                -- 0.0 to 1.0
  author_agent      TEXT,
  author_user       TEXT,
  author_machine    TEXT,
  created_at        TIMESTAMPTZ,
  last_modified_at  TIMESTAMPTZ,
  last_used_at      TIMESTAMPTZ,
  use_count         INTEGER,
  supersedes        JSONB,                -- ids replaced by this
  superseded_by     TEXT,                 -- id that replaces this
  warnings          JSONB,
  content_hash      TEXT,                 -- sha256 over (repo, scope, topic, kind, title, body)
  lamport           BIGINT,               -- monotonic write counter
  deleted           BOOLEAN,
  tombstone_at      TIMESTAMPTZ,
  embedding_v1      BYTEA                 -- 384-dim float32, optional
);
```

Plus `sb_meta` (schema version), `sb_conflicts` (sync conflicts), `sb_audit_log` (write history), `sb_sync_state` (per-repo last-push/pull lamport).

## Repository identity

A repo's identity is its **canonicalized remote URL** — lowercased host, no protocol, no auth, no `.git` suffix, no port. So `git@github.com:vnmoorthy/shadowbrain.git` and `https://github.com/vnmoorthy/shadowbrain` both become `github.com/vnmoorthy/shadowbrain`. Worktrees and submodules inherit the parent remote's identity.

## Concurrency

PGLite is local-process-only — concurrent writers corrupt the DB. We enforce single-writer via `~/.shadowbrain/serve.lock` (a PID-stamped file). The CLI refuses to `serve` if the lock is held.

For Postgres backends this constraint goes away — you can run multiple `shadowbrain serve` processes against the same Postgres instance.

## Token budget mental model

- Each retrieved entry costs roughly `tokens(title) + tokens(body)` ≈ 4 chars/token.
- Default `token_budget` is 2000 — about 4-8 entries depending on size.
- The budget cap is in *score order*: highest-scoring entries get admitted first, regardless of size.

## What lives outside the repo

```
~/.shadowbrain/
├── db/                # PGLite database files
├── trust.yaml         # per-remote trust tiers
├── conflicts.jsonl    # sync conflict log
├── sessions.jsonl     # opt-in observation log
├── sync/              # git mirror checkout
├── models/            # local embedder weights cache
├── serve.lock         # single-writer lock (only present while serving)
└── config.json        # sync mode + remote
```

## Composition with other tools

- **gstack** — Shadowbrain is a memory primitive that gstack skills can read/write. The retrospective skill (`/retro`) is a natural place to call `memory_put`.
- **groundtruth** — Stop hook can be configured to require a `memory_put` for sessions that made meaningful changes. Opt-in, off by default.
- **claude-mem** — single-machine, Claude-only. Shadowbrain spans agents and machines. Not a replacement; users may run both.
- **Mem0 / Letta / Cursor Memories** — those target chatbot memory or vendor-specific memory. Shadowbrain is structured + cross-agent + open.

See `docs/COMPARISON.md` for a head-to-head.
