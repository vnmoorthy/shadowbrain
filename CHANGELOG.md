# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`shadowbrain import --unsafe` flag.** `import` now runs the same secret/PII/adversarial scans as `memory_put` by default and refuses entries that fail. Use `--unsafe` only when restoring a backup you trust bit-for-bit. Loud stderr warning when set.

### Fixed

- **Sync state SQL hardening.** `src/sync/git-mirror.mjs` `readState`/`writeState` no longer interpolate column names. A `STATE_COLUMNS` allowlist gates `last_push` / `last_pull`; unknown keys throw. Not currently exploitable (callers hardcoded), but reintroduced the exact pattern the autoplan Eng review flagged in the v0.5 draft of `repository.mjs`.
- **`gitConfigGet` no longer shells out.** `execSync('git config ...')` replaced with `spawnSync` plus a 1-second timeout. Drops the `/bin/sh` dependency and matches the rest of the codebase.
- **Sync no longer drops array data on equal-lamport divergence.** Pull loop always invokes `resolveConflict`. Two machines with clock skew can produce equal lamports for divergent writes; the resolver's `arraysWouldBeLost` check is the right place to short-circuit truly-identical content.
- **Malformed `trust.yaml` no longer fails silently.** `loadTrustStore` warns via `log.warn` when the YAML parser throws. The fail-closed behavior (writes denied) is unchanged; the user now learns about the corruption instead of seeing every write fail with no signal.
- **`zod` declared explicitly in `dependencies`.** Was only present transitively via `@modelcontextprotocol/sdk` — a future SDK upgrade or different install resolution would have broken `npm install -g shadowbrain` at the first call into validators.
- **Sync correctness: peer Lamport timestamps preserved on pull.** `Repository.put` now accepts `{ fromSync: true }`. `pullMirror` passes it on every imported entry, so peer-originated rows keep the peer's Lamport and `last_modified_at` instead of getting re-stamped with the local clock and pushed back as fresh writes. Idempotent sync hits also upgrade lamport when incoming > existing (peers converge upward, never silently regress).
- **CLI commands acquire the writer lock.** `audit`, `conflicts resolve`, `decay`, `export`, `import`, `repo`, `sync pull/push/daemon` now go through `withLockedRepo()` (or an explicit `acquireDbLock`). Running them while `shadowbrain serve` is up no longer corrupts the WAL — the second process exits with `DB_LOCKED`.
- **Import scanner gate (security).** `shadowbrain import` previously bypassed the secret/PII/adversarial scanners that the MCP layer runs. A malicious `.jsonl` could plant credentials or prompt-injection that auto-synced via `sync push`. Imports now run the shared `runScans` pipeline by default; refused entries are reported and the command exits non-zero. Use `--unsafe` to bypass for trusted backups.

### For contributors

- **`fromSync` semantics documented in `Repository.put`.** Two peers writing identical content under the same coordinates land on different ids; only `lamport` converges. Each peer's `.json` file lives on as a phantom in the sync git repo (annoyance, not corruption). See `test/integration/peer-convergence.test.mjs` for the two-round-trip stabilization test.
- **New shared module `src/ingest/scan-pipeline.mjs`.** `runScans(entry, opts)` throws `SECRET_DETECTED` / `PII_DETECTED` / `BodyTooLarge` and returns adversarial-content warnings. `mcp/server.mjs` and `cli/import.mjs` both call it — DRY across the two write paths.
- **+18 regression tests.** `sync-lamport-preserve` (4), `cli-lock-acquisition` (3), `import-scanner-gate` (7), `peer-convergence` (1) — plus the prior CHANGELOG fixes already had their own. 107/107 pass.

## [0.5.0] — 2026-05-02

The full v0.5 surface from the spec. v0.5 ships alongside v0.1 in a single binary; the slim v0.1 path remains supported.

### Added

- **Six MCP tools.** `memory_search`, `memory_put`, `memory_get`, `memory_list`, `memory_forget`, `memory_audit`. (v0.1 shipped two.)
- **Hybrid retriever.** BM25 + dense embeddings + reranker + token-budget cap. Precision@5 = 0.959 on the gold set with the hash embedder; tracked in CI.
- **Local embedder.** `Xenova/bge-small-en-v1.5` (384-dim, 33MB). Optional remote embedders via `SHADOWBRAIN_EMBEDDER=openai|voyage|cohere`.
- **Sync via isomorphic-git.** `shadowbrain sync init/push/pull/status/daemon`. Lamport-timestamp last-write-wins with structured array merge.
- **Conflict resolution.** `~/.shadowbrain/conflicts.jsonl` + `shadowbrain conflicts review/resolve`. Chaos test with 10 simulated engineers and random reconnect orders.
- **Decay engine.** Confidence ages without use. `shadowbrain decay` applies the curve and prunes below threshold. Tombstones live 30 days then hard-delete.
- **Trust + scope engine.** Three tiers per remote (read-write, read-only, deny). Sticky decisions in `~/.shadowbrain/trust.yaml`. Monorepo path-prefix scoping for npm/pnpm/yarn workspaces, nx, turbo, cargo, go.work.
- **Secret + PII scanners.** AWS, GCP, GitHub, OpenAI, Anthropic, Stripe, JWT, PEM, npm, Slack, Twilio, SendGrid, Square. SSN + credit-card block; email + phone warn (configurable per-repo).
- **Adversarial-content enricher.** Patterns like `eval(`, `curl|bash`, `dangerouslySetInnerHTML` attach warnings.
- **Idempotency via content_hash.** Same content under same coordinates → no duplicate.
- **Lamport timestamps.** Survives clock skew between machines.
- **9-host install experience.** Auto-detect Claude Code, Cursor, Codex, OpenCode, Factory, Slate, Hermes, Kiro, OpenClaw. JSON-config edit with `.bak` backup; CLI path preferred where available (`claude mcp add`).
- **`install.sh`.** One-paste installer.
- **CLI surface.** 14 commands: serve, doctor, status, reset, install, uninstall, audit, decay, trust, sync, conflicts, repo, export, import.
- **SKILL.md.** 10 good + 10 bad examples; explicit prompt-injection warning.
- **Documentation.** ARCHITECTURE.md, SECURITY.md, PROTOCOL.md, TRUST_MODEL.md, COMPARISON.md, FAQ.md, findings.md.

### Changed

- Schema migration v1 → v5 via `ALTER TABLE ADD COLUMN IF NOT EXISTS` — backwards-compatible with v0.1 readers.
- `Repository.open` now returns the v0.5 repository; the slim v0.1 repository is exposed separately as `openRepoV01`.
- `memory_search` results are wrapped in `<shadowbrain-entry>` delimiters (was already in v0.1; now consistently across all read tools).

### Security

- All `repository.mjs` queries are parameterized (autoplan Eng review #3 fixed).
- Single-writer flock at `~/.shadowbrain/serve.lock` prevents concurrent-Claude-Code DB corruption.
- Zero outbound by default; CI grep-verifies.

## [0.1.0] — 2026-05-02

Initial release. Slim surface for the 4-week v0.1 user-discovery sprint.

### Added

- 2 MCP tools: `memory_put`, `memory_search`.
- 4 CLI commands: `serve`, `doctor`, `status`, `reset`.
- PGLite single backend; LIKE-only search.
- Single-writer flock.
- Opt-in JSONL observation log (`SHADOWBRAIN_OBSERVE=1`).
- README, LICENSE, install via `claude mcp add`.
- 23 tests across unit + integration.
