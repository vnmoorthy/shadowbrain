# Shadowbrain × gstack

Shadowbrain is a memory primitive; gstack is a sprint loop. They compose well: gstack's reflective skills (`/retro`, `/learn`) are natural places to write memories, and shadowbrain's `memory_search` is a natural first step inside any of gstack's planning skills.

## Setup

Assumes gstack is installed at `~/.claude/skills/gstack/` (per the gstack docs).

```bash
npm install -g shadowbrain
claude mcp add shadowbrain -- shadowbrain serve
shadowbrain trust set $(git config --get remote.origin.url) --tier read-write
```

## Pattern 1 — `/retro` writes memory

Edit your gstack `/retro` skill to call `memory_put` after the post-mortem write-up. Drop in:

```bash
# inside ~/.claude/skills/gstack/retro/SKILL.md, in the "outputs" section:
# After writing the retro doc, surface non-obvious learnings via memory_put.
# The agent reads the retro doc and emits 1-3 memory_put calls per non-obvious
# insight, with kind="dead_end" or kind="gotcha" as appropriate.
```

## Pattern 2 — `/office-hours` searches memory first

Before interrogating the user about prior decisions, the office-hours skill calls `memory_search` for the topic. If a `decision` entry exists, the skill reads it before asking and avoids re-litigation.

## Pattern 3 — `/plan-eng-review` cross-references gotchas

Before approving a plan that touches a known fragile area, `/plan-eng-review` calls `memory_search({ kind: "gotcha", topic: <module>, repo: <current> })` and surfaces any gotchas in the review.

## Why this beats gstack-brain alone

- **Cross-machine.** gstack-brain is single-machine. Shadowbrain syncs via git or shared Postgres.
- **Cross-agent.** A teammate using Cursor on the same repo inherits the gstack-derived learnings.
- **Trust + audit.** A teammate's compromised agent can't poison your local memory without crossing a trust-tier check.

## Why gstack-brain still has a place

- **Zero new dependency.** If you're already on gstack and don't want a second tool, gstack-brain is fine for solo work.
- **Tighter integration.** gstack-brain ships pre-tuned for gstack skill calls; shadowbrain takes one config decision (the trust tier) before it works.

If you're solo-only and gstack-only, start with gstack-brain. If you have a team or run multiple agents, switch to shadowbrain.
