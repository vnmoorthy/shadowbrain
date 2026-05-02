# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [SemVer](https://semver.org/spec/v2.0.0.html).

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
