# /office-hours Review — 2026-05-02

Verbatim source: `~/.gstack/projects/ShadownBrain/moorthy-main-design-20260502-054717.md`. This file captures the diagnosis pre-/autoplan.

Mode: Startup. Quality after 2 reviewer iterations: 8/10.

## Diagnosis

Founder scaffolded 1,786 LOC across 5 architectural layers (MCP server, storage, sync, trust, decay) before naming a single user. Most common pre-product founder mistake. The skill is real; the order needs reversing.

## Demand reality

**No named users yet.** D3 answer: "honest — nobody yet." The nuclear prompt cites "Garry Tan's pattern" — that's an aspirational pattern, not a customer.

## Status quo

Reframed during diagnosis from "nothing exists" → "this category is crowded":

- **claude-mem** — MCP server, installed in Claude Code sessions today
- **Mem0** — open-core memory layer, raised real money
- **Letta (formerly MemGPT)** — open-source agent memory layer
- **Cursor's built-in Memories** — shipped late 2024
- **Anthropic's Projects + memory** — built into Claude Code via CLAUDE.md hierarchy
- **LangMem, Zep, Cognee, Graphiti** — at least four other VC-backed competitors
- **gstack-brain** — already syncs gstack memory across machines via private git repo

The honest claim: nothing combines `cross-agent + open-source + structured-schema + trust-tiered + decay-aware`. That's a much narrower position. Question: does anyone want that intersection enough to switch?

## Wedge

**A: Cross-agent open standard.** The only memory layer that works across Claude/Cursor/Codex/Aider/etc. Structurally undermineable by closed competitors (Cursor can't open up — that would weaken their moat). Small TAM today; betting multi-agent workflows become mainstream.

## Persona

Couldn't name a specific user yet. Hypothetical persona: solo founders running parallel sprints, multi-agent power users. Remediation: outreach assignment.

## Premises flagged for validation

- **P1:** Cold-start pain is acute enough that devs install another tool — UNPROVEN, central premise.
- **P2:** Multi-agent workflows grow enough that "cross-agent" becomes meaningful TAM.
- **P3:** MCP becomes the dominant protocol for agent→tool integration. (Foundational — flagged by CEO subagent later.)
- **P4:** Open structured schema is reliably emittable by agents and beats embedding-only recall. (Mem0 tried, found it hard.)
- **P5:** MIT OSS funded by goodwill can sustain 5 layers + 8 adapters. (CEO push-back: every comparable that won had a commercial layer.)

## What I noticed about how you think (from the reviewer)

- Scaffolded 1,786 LOC before naming a user → most common pre-product mistake, but also a mark of someone who can ship. Order needs reversing, not the skill.
- Let "nothing exists" reframe land without arguing.
- Honestly flagged P1-P4 as needing validation — unusually honest read of own assumptions.

## The original 3-week assignment (revised to 4 weeks in /autoplan)

Find 5 named humans (later cut to 3 cold + captive cohort). Get on a call. One question: "When you're starting a new Claude Code session, what do you wish was already there that wasn't?" Take notes verbatim. Quote them in the next office hours.

Outreach template:
> Hey [name] — building a small open-source MCP server that lets Claude Code remember the gotchas it figured out in past sessions, instead of re-deriving them every time. Trying to find 5 people who run Claude Code regularly to be early users. ~10 min call this week, no pitch, I just want to ask what you wish your sessions remembered. Up for it?
