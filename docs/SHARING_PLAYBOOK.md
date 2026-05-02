# Sharing Playbook — drafts only, do not submit yet

This file is the founder's reference for how to share Shadowbrain when the v0.1 sprint validates P1. Per the autoplan, do NOT publish any of this until you have ≥3 cold-outreach users with retention by week 4.

## Show HN — draft

> **Show HN: Shadowbrain — shared memory for Claude Code, Cursor, Codex over MCP**
>
> Every coding agent session starts cold. Claude Code, Cursor, Codex, Aider, OpenCode — they all rediscover your codebase conventions, past architectural decisions, debugging dead-ends, every time. A team running 10 parallel sprints across 5 engineers re-derives the same context hundreds of times per week.
>
> Shadowbrain is the memory layer for that. One MCP server, one paste to install, six tools (memory_search, memory_put, memory_get, memory_list, memory_forget, memory_audit). Local-first PGLite by default; sync across machines via a private git repo or self-hosted Postgres. Three trust tiers per repo — read-write, read-only, deny. Confidence ages so stale knowledge doesn't poison new sessions.
>
> What it's not: chatbot memory (Mem0's lane), an agent runtime (Letta's lane), or a hosted SaaS (zero outbound by default; sync goes only to a remote *you* configure).
>
> What's hard: making the structured schema (decision/pattern/gotcha/dead_end/...) actually useful when agents are sloppy — Mem0 tried this and went embedding-only. Our bet is that a 10-kind taxonomy + the right SKILL.md instructions for the agent + a hybrid retriever that actually weights kind-specific signal makes the schema pay rent. Precision@5 = 0.96 on a 50-query gold set with the local hash embedder.
>
> MIT, https://github.com/vnmoorthy/shadowbrain — install: `curl -fsSL https://raw.githubusercontent.com/vnmoorthy/shadowbrain/main/install.sh | bash`
>
> Looking for honest feedback. Specifically: who runs more than one coding agent? what does cold-start cost you in a typical week? Email moorthy@shadowbrain.dev or reply here.

**Pre-submit checklist:**

- [ ] At least 3 named users have used it for >7 days
- [ ] At least 1 verbatim quote about a moment it saved time
- [ ] CHANGELOG, README, install.sh all green on a fresh Linux container
- [ ] `npm run audit:no-outbound` is clean on the merge commit you're linking to
- [ ] You're online and ready to engage for ~6 hours after submitting

## awesome-claude-code PR — draft

In the appropriate "Tools" / "Memory" section:

```markdown
- [Shadowbrain](https://github.com/vnmoorthy/shadowbrain) — Shared memory for coding agents over MCP. Six tools, structured schema, trust tiers, decay-aware. Composes with Claude Code, Cursor, Codex, Aider, OpenCode. MIT.
```

## Twitter / X thread — draft

1/ shipping shadowbrain v0.5: shared memory for coding agents.
   one MCP server. six tools. local-first or git-synced. MIT.
   github.com/vnmoorthy/shadowbrain

2/ every claude code, cursor, codex session starts cold.
   the agent rediscovers your conventions, past decisions,
   debugging dead-ends. every time. shadowbrain remembers.

3/ structured schema, not embedding-soup. ten kinds:
   decision/pattern/gotcha/dead_end/anti_pattern/...
   the reranker weights gotchas above patterns when both match.
   precision@5 = 0.96 on the gold set.

4/ trust tiers per repo. read-write, read-only, deny.
   memory writes can't poison repos you didn't grant.
   the secret scanner refuses to store credentials. the PII
   scanner blocks SSNs by default.

5/ sync via your own private git repo. lamport timestamps
   for last-write-wins, structured array merge for tags/files.
   chaos-tested with 10 simulated engineers, random reconnect
   orders, deterministic final state.

6/ install: `curl -fsSL <url> | bash`
   doctor: `shadowbrain doctor`
   that's it. 5 minutes from zero to your agent inheriting context.

7/ this is v0.5. v1.0 locks the schema. roadmap on the repo.
   feedback wanted, especially from anyone running 2+ agents.
   honest framing: this is a bet that multi-agent dev grows.
   if you only run one agent deeply, your tool's native memory
   may already be enough.

## gstack composition example

→ `examples/gstack-composition/README.md` is the long-form. For the share, the one-paragraph version:

> Shadowbrain works alongside gstack — gstack's `/retro` skill is a natural place to call `memory_put` with what the sprint learned, and shadowbrain's `memory_search` is a natural first step inside `/office-hours`. gstack-brain users don't have to rip-and-replace; shadowbrain becomes the memory primitive that gstack-brain v2 may eventually delegate to.

## Things to NOT say

- "10x faster than X" — not measured against any specific competitor under controlled conditions
- "Solves cold-start" — it solves *part of* the cold-start tax for users running multi-agent setups
- "The standard for agent memory" — there is no standard yet; positioning ourselves as one is premature
- "AI" or "AI memory" — say "agent memory" or "memory for coding agents", more specific
- Anything about ARR, customers, or commercial intent until v0.5 commercial wedge is decided per the autoplan
