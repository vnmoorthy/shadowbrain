# Roadmap

Where Shadowbrain is going. Subject to user signal — the v0.1 sprint output dictates everything below.

## Now (v0.5.x)

- Bug fixes from week-3 user observations.
- Per-host quirk patches as new agents come online.
- Quality bumps to the gold-set precision@5 number (real `bge-small-en-v1.5` numbers, OpenAI / Voyage benchmarks).

## v0.6 — multi-user-on-one-machine

- Distinct trust stores per OS user.
- A `multi-user.yaml` for shared-machine workflows (devcontainers, VMs, CI runners).

## v0.7 — Postgres-shared team mode

- Native Postgres backend with row-level scoping per repo.
- A first-class `--mode team` install flow that points at a Supabase / RDS / self-hosted instance.
- Conflict resolution moves from git to PG triggers when the team mode is active.

## v0.8 — observability

- An optional read-only dashboard (HTML, no SaaS) that shows entry growth, retrieval precision per repo, decay curves.
- Metric: "tokens saved per week" — measure cold-start savings vs. baseline.

## v1.0 — stable surface

- Lock the Entry shape behind a `1.0` schema_version. Migrations afterwards are additive only.
- Lock the MCP tool descriptions. No silent renames.
- Public docs site.

## Post-v1.0 (commercial wedge candidates)

Per the autoplan finding #8 (`docs/REVIEWS/autoplan.md`), v0.5+ commercial layer is gated on v0.1 validating P1. Three candidates:

1. **Hosted sync as a paid service.** Free local. Pay for the team-shared sync tier.
2. **Trust + audit primitives behind a paid plan.** Compliance reporting, change history, redaction tooling — targets regulated industries.
3. **Managed embeddings + reranker.** Free lexical search; pay for hosted vectors + reranker.

License v0.5+ commercial layer as BSL or similar source-available; OSS core remains MIT.

## Things explicitly NOT on the roadmap

- A hosted SaaS dashboard for solo users. v0.5 is local-first.
- Replacing CLAUDE.md, .cursorrules, or any tool's native memory. Compose, don't compete.
- A web UI for editing memory. The CLI + your editor are the right interface.
- Conversation memory. That's Mem0/Letta's lane.
