# Comparison

How Shadowbrain relates to other memory layers.

| | Shadowbrain | Mem0 | Letta | Cursor Memories | Anthropic project memory | claude-mem | gstack-brain |
|---|---|---|---|---|---|---|---|
| **Cross-agent** | ✓ any MCP host | ✗ Mem0 SDK | ✗ Letta SDK | ✗ Cursor only | ✗ Claude only | ✗ Claude Code only | ✗ gstack only |
| **Cross-machine** | ✓ via git | ✓ hosted | ✓ hosted | ✓ via Cursor cloud | ✓ via Anthropic cloud | ✗ machine-local | ✓ via git |
| **Open source** | ✓ MIT | ✓ Apache (open core) | ✓ Apache | ✗ closed | ✗ closed | ✓ MIT | ✓ MIT |
| **Hosted required** | ✗ self-host or local | optional | optional | ✓ | ✓ | ✗ | ✗ |
| **Structured schema** | ✓ 10 kinds + tags | partial | partial | ✗ | ✗ | partial | ✗ |
| **Trust tiers / audit** | ✓ per-remote | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Decay-aware** | ✓ confidence ages | ✗ | partial | ✗ | ✗ | ✗ | ✗ |
| **Built for code** | ✓ | ✗ chatbot-shaped | ✗ chatbot-shaped | ✓ | partial | ✓ | ✓ |
| **Conflict resolution** | ✓ Lamport + structured merge | hosted handles it | hosted handles it | hosted | hosted | n/a (single-machine) | last-write-wins |
| **Local embedder** | ✓ bge-small-en (33MB) | requires API | requires API | hosted | hosted | local | local |

## When to use which

- **Shadowbrain** — you run more than one coding agent (or your team does); you want memory that survives across both; you want auditability and trust controls; you're OK with self-hosting.
- **Mem0** — you're building a *chatbot*, not a coding agent. Mem0's structure is conversational facts ("user prefers JSON"), not codebase-shaped knowledge.
- **Letta** — you want a stateful agent server with hierarchical memory and tool calling; you're building the agent itself, not augmenting an existing one.
- **Cursor Memories** — you've standardized on Cursor and don't run any other agent. Lowest friction inside Cursor.
- **Anthropic project memory** — you've standardized on Claude Code and want zero infrastructure. Lives in `CLAUDE.md` hierarchy + project-level memory.
- **claude-mem** — you want lightweight cross-session memory for Claude Code on one machine. Direct MCP overlap with Shadowbrain; many users will run both for different repos.
- **gstack-brain** — you're already deep in gstack. gstack-brain is the on-ramp; Shadowbrain is the memory primitive that gstack-brain v2 may eventually delegate to.

## Compose, don't compete

Shadowbrain is designed to compose with these tools, not replace them:

- **claude-mem + Shadowbrain** — claude-mem for ephemeral session-bridging on this machine; Shadowbrain for durable, cross-machine, cross-agent knowledge.
- **CLAUDE.md + Shadowbrain** — CLAUDE.md for static project conventions you'd give a new hire on day one; Shadowbrain for dynamic, session-derived knowledge.
- **groundtruth + Shadowbrain** — groundtruth gates honesty; Shadowbrain captures what the honest answer was so the next agent doesn't have to re-derive it.
- **gstack + Shadowbrain** — gstack drives the sprint loop; the `/retro` skill is a natural place to call `memory_put` with what was learned.

## What Shadowbrain doesn't do (and won't in v0.5)

- **Chatbot conversation memory.** That's Mem0's lane.
- **Agent runtime / state management.** That's Letta's lane.
- **Code search.** Use grep, ripgrep, or your IDE. Shadowbrain stores *learnings*, not code.
- **Hosted SaaS.** Self-host or git-sync only. SaaS is roadmap, not v0.5.
