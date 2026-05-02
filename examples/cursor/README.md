# Cursor + Shadowbrain

## Install

```bash
npm install -g shadowbrain
shadowbrain install cursor
```

This writes `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "shadowbrain": {
      "command": "shadowbrain",
      "args": ["serve"],
      "env": {}
    }
  }
}
```

A `.bak` of any pre-existing config is written next to the file. Restart Cursor to pick up the change.

## Verify

In Cursor's MCP server panel (Settings → MCP) you should see `shadowbrain` listed as Connected.

In a Cursor agent chat:

> Use the memory_search tool to find any prior notes about authentication.

Cursor's agent calls `memory_search`. Empty result is `{ ok: true, results: [] }` not an error.

## Trust grant

Same as Claude Code:

```bash
shadowbrain trust set github.com/youruser/yourrepo --tier read-write
```

## Uninstall

```bash
shadowbrain uninstall cursor
```

This restores the `.bak` if present, or removes the `shadowbrain` entry from `mcpServers`.
