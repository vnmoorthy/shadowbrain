# OpenClaw + Shadowbrain

OpenClaw spawns Claude Code sessions natively via ACP. The MCP entry lives in Claude Code's config — so installing for Claude Code is enough.

## Install

```bash
npm install -g shadowbrain
shadowbrain install claude-code   # registers with Claude Code
shadowbrain install openclaw      # drops a marker file at ~/.openclaw/shadowbrain.marker
```

`shadowbrain status` will then show OpenClaw users specifically as registered.

## Why two installs?

`shadowbrain install openclaw` doesn't add a new MCP entry — it records that the user expects shadowbrain to be available in OpenClaw-spawned Claude Code sessions. The actual MCP plumbing is the Claude Code install.

## Verify

Start a Claude Code session through OpenClaw. The agent should see `memory_search` and `memory_put` in its tool list.
