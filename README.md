# shadowbrain

Shared, queryable memory layer for coding agents — Claude Code, Cursor, Codex, OpenCode, Factory, Slate, Hermes, Kiro, OpenClaw. One MCP server, six tools, local-first or git-synced. **MIT.**

```bash
curl -fsSL https://raw.githubusercontent.com/vnmoorthy/shadowbrain/main/install.sh | bash
```

## Why

Every coding-agent session starts cold. Each one rediscovers your codebase conventions, past decisions, debugging dead-ends. A team running 10 parallel sprints across 5 engineers re-derives the same context hundreds of times per week. Shadowbrain is the memory layer for that.

- **Cross-agent.** Any MCP host. The same memory the agent wrote yesterday in Claude Code is what it reads tomorrow in Cursor.
- **Cross-machine.** Sync via your private git repo or a self-hosted Postgres.
- **Structured.** Ten kinds — `decision | pattern | anti_pattern | gotcha | dead_end | convention | integration | deployment | glossary | todo`. The reranker weights `gotcha` above `pattern` for the same query, because that's what you needed.
- **Trust-aware.** Three tiers per remote (read-write, read-only, deny). Sticky decisions. Memory writes from a teammate's compromised agent can't poison repos you didn't grant.
- **Decay-aware.** Confidence ages without use. Stale knowledge drops out of retrieval before it reaches your context.
- **Defense-in-depth.** Secret scanner refuses to store credentials. PII scanner blocks SSNs by default. Adversarial-content detector flags `eval(`, `curl|bash`, etc. with warnings.

## Install

### Quickstart (one paste)

```bash
curl -fsSL https://raw.githubusercontent.com/vnmoorthy/shadowbrain/main/install.sh | bash
```

The installer:

1. Verifies Node 20+.
2. Clones into `~/.shadowbrain-pkg`.
3. Runs `npm ci`.
4. Symlinks `shadowbrain` into `~/.local/bin`.
5. Detects coding agents and registers the MCP server with each (with `.bak` backups).
6. Initializes the local PGLite database.
7. Runs `shadowbrain doctor`.

### Manual

```bash
npm install -g shadowbrain
shadowbrain install --all      # registers with every detected agent
shadowbrain doctor             # verify
```

Or per-agent:

```bash
shadowbrain install claude-code
shadowbrain install cursor
shadowbrain install codex
# ... opencode, factory, slate, hermes, kiro, openclaw
```

### Trust your repo

`memory_put` against an unknown repo returns `WRITE_DENIED` by design. Grant once:

```bash
shadowbrain trust set $(git config --get remote.origin.url) --tier read-write
```

## Verify

In any agent session:

> Use `memory_put` to remember that this project uses pnpm, not npm.

Open a new session, ask:

> Use `memory_search` to look up which package manager this project uses.

You should see the recall.

## Six MCP tools

| Tool | Purpose |
|---|---|
| `memory_search(query, repo?, scope?, kind?, token_budget?, limit?)` | Hybrid retrieval (BM25 + dense + recency + confidence + kind weight) within a repo, capped by token budget. |
| `memory_put({ title, body, kind?, topic?, repo?, scope?, tags?, confidence? })` | Store an entry. Idempotent by content hash. |
| `memory_get(id)` | Fetch one entry. |
| `memory_list({ repo?, scope?, topic?, kind?, limit?, offset? })` | Browse. |
| `memory_forget(id, reason?)` | Soft-delete; tombstone for 30 days. |
| `memory_audit({ repo?, since?, limit? })` | Review entries with author + warnings. |

Every retrieved body is wrapped in `<shadowbrain-entry>...</shadowbrain-entry>` and the tool description tells the agent it's user data, not instructions.

## CLI

```
shadowbrain serve         start the MCP server
shadowbrain doctor        diagnostics — node, home, lock, db, agent registration
shadowbrain status        version + db + lock + claude state
shadowbrain reset         wipe ~/.shadowbrain (asks for confirmation)
shadowbrain install       register with detected agents
shadowbrain uninstall     remove + restore .bak
shadowbrain audit         list entries + warnings
shadowbrain decay         apply confidence decay + prune
shadowbrain trust         manage per-remote trust tiers
shadowbrain sync          init / pull / push / status / daemon
shadowbrain conflicts     review and resolve sync conflicts
shadowbrain export        dump to JSONL or YAML
shadowbrain import        load from JSONL or YAML
shadowbrain repo          list / rename canonical repo URLs
```

## Sync across machines

```bash
# on machine A
shadowbrain sync init --remote git@github.com:youruser/shadowbrain-sync.git
shadowbrain sync push

# on machine B
shadowbrain sync init --remote git@github.com:youruser/shadowbrain-sync.git
shadowbrain sync pull
```

Or run the daemon for continuous sync:

```bash
shadowbrain sync daemon
```

Conflicts are Lamport-resolved with structured array merge; every conflict is logged for `shadowbrain conflicts review`.

## Privacy

**Zero outbound by default.**

- Sync goes only to a remote *you* configure.
- Once-a-day update check against the npm registry. Disable: `SHADOWBRAIN_NO_UPDATE_CHECK=1`.
- Optional remote embedders if you set `SHADOWBRAIN_EMBEDDER=openai|voyage|cohere`. Off by default.

CI grep-verifies via `npm run audit:no-outbound`.

The opt-in observation log (`SHADOWBRAIN_OBSERVE=1`) writes only `{ts, tool, success, latency_ms, result_count}` to `~/.shadowbrain/sessions.jsonl`. Never query content, entry text, or tags.

## Documentation

- `docs/ARCHITECTURE.md` — five-layer model, data flow, schema
- `docs/PROTOCOL.md` — entry shape, retrieval algorithm, conflict resolution
- `docs/SECURITY.md` — threat model, mitigations, what's NOT covered
- `docs/TRUST_MODEL.md` — three tiers, repo identity, monorepo scoping
- `docs/COMPARISON.md` — vs Mem0, Letta, Cursor Memories, claude-mem, gstack-brain
- `docs/FAQ.md` — common questions
- `docs/findings.md` — per-host MCP transport quirks
- `skills/shadowbrain/SKILL.md` — what coding agents should know

## Composes with

- **gstack** — `examples/gstack-composition/`
- **groundtruth** — `examples/groundtruth-composition/`
- **CLAUDE.md** — keep CLAUDE.md for static project conventions; use shadowbrain for dynamic, session-derived knowledge

## License + contact

MIT. Issues: https://github.com/vnmoorthy/shadowbrain/issues. Security: see `docs/SECURITY.md`.
