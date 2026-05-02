# FAQ

## Why another memory tool?

The autoplan summary at the top of `docs/REVIEWS/autoplan.md` answers this honestly: *most* memory tools today are closed (Cursor Memories, Anthropic project memory) or chatbot-shaped (Mem0, Letta). Shadowbrain is the slot that says "open + structured + cross-agent + trust-tiered + decay-aware." Whether that's a feature anyone will pay for is what the v0.1 sprint is testing.

## Does this work without Claude Code?

Yes — anything that speaks MCP works (Cursor, Codex, OpenCode, Factory, Slate, Hermes, Kiro). The install script auto-detects what's on your machine and registers the server with each.

## Where does my memory live?

`~/.shadowbrain/db/` — a PGLite database, file-based, single-process. Survives restarts. Mode `0700`.

If you've enabled sync, also in your private git remote (one JSON file per entry under `entries/<repo-slug>/`).

## Will it sync across machines?

Yes — via a private git repo of your choice. `shadowbrain sync init --remote git@github.com:youruser/shadowbrain-sync.git`. Conflict resolution is Lamport-timestamp last-write-wins with structured merge for arrays. Every conflict is logged to `~/.shadowbrain/conflicts.jsonl`.

If you'd rather use Postgres as a team-shared backend, set `SHADOWBRAIN_BACKEND=postgres SHADOWBRAIN_PG_URL=<url>`.

## Will my memory leak across repos?

No. By default, `memory_search` is scoped to the current repo (auto-detected from `git config remote.origin.url`). Cross-repo retrieval requires explicitly tagging an entry with `cross-repo` or passing `repo` explicitly.

## Can I store secrets?

No. The server scans for AWS keys, GH PATs, OpenAI/Anthropic, JWTs, PEM blocks, etc. and rejects writes with `SECRET_DETECTED`. This is by design.

## What about PII?

SSN-shaped strings and Luhn-valid credit cards block by default. Emails and phone numbers warn (the entry stores but gets a warning). Configurable per-repo.

## How big can an entry be?

~4000 tokens for the body. Bigger entries get rejected. Summarize.

## What happens if two engineers write conflicting entries?

The conflict resolver runs at sync time. Higher Lamport timestamp wins for scalar fields; arrays (tags, files, etc.) union-merge. Every conflict is logged for `shadowbrain conflicts review`.

## How does retrieval rank entries?

Hybrid retriever: BM25 + dense embeddings + recency decay + confidence + kind weight + author trust + warning penalty, capped by token budget. See `docs/PROTOCOL.md` for the algorithm and `test/integration/retrieval-gold.test.mjs` for the gold-set evaluation.

## Will this slow my agent down?

Cold start is ~600-900ms for PGLite open + migrate. Per-call latency for `memory_search` on a 1000-entry corpus is <100ms with the local hash embedder. Real local embedder (`bge-small-en-v1.5`) adds ~30ms per call. The MCP transport is stdio so there's no network round-trip.

## Does it run on Windows?

The pure-Node parts work. PGLite ships native bindings for Windows. The `flock` lock uses `proper-lockfile` semantics (PID file, no fcntl), so it's portable. Untested in CI; report issues.

## Can I use it without git?

Yes — the local PGLite store works without any sync. `repo` falls back to the directory basename when no git remote is configured.

## How do I uninstall?

```bash
shadowbrain uninstall --all   # remove MCP registrations
rm -rf ~/.shadowbrain         # remove data
rm -rf ~/.shadowbrain-pkg     # remove the install
```

If you installed via npm globally: `npm uninstall -g shadowbrain` instead of removing `~/.shadowbrain-pkg`.

## Is the memory encrypted at rest?

No. Memory is stored in a PGLite database file with mode `0700`. If you need encryption at rest, encrypt your home directory (FileVault, LUKS, BitLocker).

## How is this different from claude-mem?

claude-mem is single-machine, Claude-Code-only. Shadowbrain spans agents and machines, has trust tiers, decay, and structured schema. Many users will run both for different needs — see `docs/COMPARISON.md`.

## Will my data be sent to Anthropic / OpenAI / anyone?

No. Zero outbound traffic by default. The local embedder runs entirely on your machine. The only outbound paths are:

1. `shadowbrain sync` to a remote *you* configure.
2. Once-a-day update check against the npm registry (disable with `SHADOWBRAIN_NO_UPDATE_CHECK=1`).
3. Optional remote embedders if you set `SHADOWBRAIN_EMBEDDER=openai|voyage|cohere`.

CI runs an audit-no-outbound script that grep-verifies no other paths exist.

## Where do I report bugs?

GitHub issues at https://github.com/vnmoorthy/shadowbrain/issues. For security issues, see `docs/SECURITY.md`.
