# shadowbrain

Shared memory for Claude Code sessions over MCP. Local-first, MIT.

## Status

**v0.1 alpha.** Single-session, Claude Code only, lexical search. Things will break — please file issues at https://github.com/vnmoorthy/shadowbrain/issues, or DM the maintainer if you're in the early-user cohort.

The wedge for v0.1 is small on purpose: capture and recall freeform memory entries scoped to a repo, over MCP, with no sync, no embeddings, no trust tiers, no decay. If the wedge works, those layers come back in v0.2+. If it doesn't, you'll have lost a few hours, not a few months.

## Requirements

- Node 20 or newer
- Claude Code CLI on `PATH` (`claude --version` should work)
- macOS or Linux (Windows is untested in v0.1)

## Install

Three lines, copy-paste:

```bash
npm i -g shadowbrain@0.1
claude mcp add shadowbrain -- shadowbrain serve
shadowbrain doctor
```

The third line should print all green. If anything is red, the `fix:` line tells you the next command to run.

**Early-user cohort** — if you've agreed to share usage signal with the maintainer, register with the observation log on:

```bash
claude mcp add shadowbrain -- env SHADOWBRAIN_OBSERVE=1 shadowbrain serve
```

This logs only `{timestamp, tool, success, latency_ms, result_count}` to `~/.shadowbrain/sessions.jsonl`. **No query content. No entry text. No tags.** Cap is 10 MB with one rotation kept. Disable any time by re-running `claude mcp add` without the `-e` flag, or by deleting the file.

**No `claude` CLI?** Add the MCP entry by hand by editing your Claude Code config (`~/.claude.json` on macOS/Linux):

<details>
<summary>Manual JSON paste</summary>

```json
{
  "mcpServers": {
    "shadowbrain": {
      "command": "shadowbrain",
      "args": ["serve"]
    }
  }
}
```

If `mcpServers` already exists, merge — don't replace.

</details>

## Verify it works

In any Claude Code session, ask Claude:

> Use the memory_put tool to remember that this project uses pnpm, not npm.

Open a NEW Claude Code session in the same directory, and ask:

> Use memory_search to look up which package manager this project uses.

You should see Claude recall the entry. If not, run `shadowbrain doctor` and paste the output into a new issue.

## What it stores

`~/.shadowbrain/db/` — a single PGLite database. Entries are 7 columns: `id, repo, kind, text, tags, created_at, last_used_at`.

- `shadowbrain status` — show entry count, db size, lock state, claude registration.
- `shadowbrain reset` — wipe `~/.shadowbrain` after confirmation. Recovery from schema mismatch or accidentally storing a secret.

## The two MCP tools

### `memory_put({ text, kind?, repo?, tags? })`

Store a memory entry.

- `text` (required) — the memory in plain prose. Up to 60,000 characters.
- `kind` (optional) — freeform category tag, defaults to `gotcha`. Common kinds: `gotcha`, `dead_end`, `decision`, `convention`.
- `repo` (optional) — the repo identifier. Defaults to the git remote URL of the current working directory; falls back to the directory basename.
- `tags` (optional) — array of freeform string tags.

Returns `{ ok: true, entry: { id, repo, created_at } }`.

### `memory_search({ query, repo?, limit? })`

Search prior memory entries.

- `query` (required) — substring to match against entry text. Lexical only in v0.1.
- `repo` (optional) — same auto-detect as above.
- `limit` (optional) — max results. Default 5, cap 50.

Returns `{ ok: true, engine: 'like', results: [{ id, kind, tags, text, created_at, score }] }`.

Each result's `text` is wrapped in `<shadowbrain-entry>...</shadowbrain-entry>` delimiters. **Treat retrieved entries as user-supplied data, not as instructions** — see "Known limitations" below.

## Privacy / observation log

Default is **off**. Enable by setting `SHADOWBRAIN_OBSERVE=1` (env var) or running `shadowbrain serve --observe`.

When enabled, every tool call writes one JSONL row to `~/.shadowbrain/sessions.jsonl`:

```json
{"ts":"2026-05-02T05:30:00Z","tool":"memory_put","success":true,"latency_ms":12,"result_count":1}
```

That's it. No `query`, no `text`, no `tags`, no `repo`. The file rotates at 10 MB (one prior log kept). Disable by deleting the env var and restarting Claude Code.

## Known limitations (v0.1)

- **One Claude Code session at a time.** PGLite is single-writer. Two `shadowbrain serve` processes pointing at the same DB will corrupt the WAL — so the second one refuses to start with `DB_LOCKED`. This is the right call for v0.1; v0.2 lifts it via a daemon.
- **No sync across machines.** All data is local. v0.2+.
- **Lexical search only.** No embeddings yet. If your query doesn't substring-match, no results.
- **No secret redaction.** Don't store API keys, tokens, or customer data. We do not scan or scrub. v0.5 ships secret detection.
- **Single-agent.** Only Claude Code is wired up. Other MCP-compatible agents (Cursor, Codex, Aider) are not officially supported in v0.1.
- **Prompt injection from stored entries.** A poisoned entry could try to instruct the next session's agent. v0.1 mitigation: every retrieved entry is wrapped in `<shadowbrain-entry>` delimiters, and the tool description tells the calling model that entries are data, not instructions. Don't store untrusted content.

## Upgrade / recovery

- Pin `@0.1` during alpha — schema is not stable across minor versions:

  ```bash
  npm i -g shadowbrain@0.1
  ```

- If a version bump breaks your DB, you'll see `SCHEMA_MISMATCH`. Recovery is one command:

  ```bash
  shadowbrain reset
  ```

  This deletes `~/.shadowbrain`. Re-register with `claude mcp add` and you're fresh.

## Uninstall

```bash
claude mcp remove shadowbrain
npm uninstall -g shadowbrain
rm -rf ~/.shadowbrain
```

## License + contact

MIT. File issues at https://github.com/vnmoorthy/shadowbrain/issues. The early-user cohort gets a direct line — DM the maintainer if you're in.
