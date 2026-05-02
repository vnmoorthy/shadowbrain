# Findings — MCP transport quirks per host

Per-host gotchas observed while building Shadowbrain's installers and shipping to real users. Update as new hosts are tested.

## Claude Code

- **CLI:** `claude mcp add shadowbrain -- shadowbrain serve` is the canonical install. The CLI handles project-vs-user scope automatically; we use it in preference to direct file edit.
- **stdio framing:** ANY write to stdout breaks the JSON-RPC framing. All logs MUST go to stderr. We learned this the hard way during a `console.log()` debugging detour (PR #...). The `src/log.mjs` module enforces stderr-only.
- **Tool descriptions matter:** Claude Code's tool-router model uses the tool description to decide when to call. "Search prior memory for the current repo" works; "Search the database" does not (Claude doesn't recognize "database" as a memory abstraction).
- **`isError: true` envelopes** are surfaced to the user as red text. We use them for typed-error responses (`SECRET_DETECTED`, `WRITE_DENIED`, etc.) so users see the `fix:` hint immediately.

## Cursor

- Config at `~/.cursor/mcp.json` (user scope) or `.cursor/mcp.json` (project scope).
- Cursor restarts MCP servers on config save. No need for manual reload.
- Cursor's MCP impl as of late 2025 didn't pass `cwd` to the spawned server. We auto-detect repo via the agent's working directory at tool-call time using `git -C $cwd config --get remote.origin.url` rather than relying on env.

## Codex CLI

- Newer versions: `~/.codex/config.toml` with TOML mcp_servers.shadowbrain table.
- Older versions: `~/.codex/settings.json` with JSON `mcp_servers`. The installer detects which exists and edits the right one.
- Codex spawns MCP servers in a subshell; environment inheritance is intentional, so `SHADOWBRAIN_HOME` overrides work cleanly.

## OpenCode

- Config at `~/.config/opencode/config.json`.
- Standard `mcpServers` schema (same as Claude Code).
- Does not currently support per-project MCP scope; all servers are user-scope.

## Factory

- Config at `~/.factory/settings.json`. Standard `mcpServers` schema.
- Skill-based architecture; the SKILL.md in `skills/shadowbrain/` is picked up automatically when this directory is sym-linked into Factory's skill discovery path. Documented in `docs/COMPARISON.md`.

## Slate

- Config at `~/.slate/config.json`. Standard `mcpServers` schema.

## Hermes

- Hermes spawns Claude Code sessions natively via ACP — so MCP entries flow through Claude Code's config. Our Hermes installer also drops a marker file at `~/.hermes/shadowbrain.marker` so `shadowbrain status` can surface Hermes users specifically.

## Kiro

- Amazon's Kiro: config at `~/.kiro/settings.json`. Standard `mcpServers` schema.
- Kiro restricts skill descriptions to <= 1024 chars. Our SKILL.md is much longer — Kiro shows a truncated description.

## OpenClaw

- Per gstack's OpenClaw notes: OpenClaw spawns Claude Code sessions natively. The MCP entry lives in Claude Code's config. We just install a marker.

## Cross-cutting

- **Stdio servers must NOT log to stdout.** True for every host. We enforce via `src/log.mjs` (stderr-only) and surface this prominently in the SKILL examples.
- **MCP `tools/call` responses with empty results** must be `{ ok: true, results: [] }`, NOT a thrown error. The user-facing message is "No matches" not "ERROR: NOT_FOUND".
- **Tool argument types:** Some hosts pass numeric `limit` as a string (`"5"` instead of `5`). The server uses `Number.isFinite(args.limit) ? Number(args.limit) : default` to be robust.
- **Long-running tools:** No host supports streaming output from MCP tools as of mid-2026. Keep `tools/call` responses small and bounded.

---

If you find a quirk we haven't documented, please open a PR adding it here.
