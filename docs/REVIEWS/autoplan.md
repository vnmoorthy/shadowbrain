# /autoplan Review — 2026-05-02

Verbatim source: `~/.gstack/projects/ShadownBrain/moorthy-main-design-20260502-054717.md` on Moorthy's machine. This file captures the actionable distillation that the v0.1 build is graded against.

Status: **APPROVED via /autoplan** (post-Eng + DX review, all 29 decisions resolved). Mode: Startup. Codex unavailable, so all phases ran with Claude subagent only — single-voice, not dual-voice.

## Verdicts

| Phase | Verdict | Findings |
| --- | --- | --- |
| CEO | ship-with-revisions | 8 (all 3 critical accepted) |
| Design | skipped (no UI) | — |
| Eng | ship-with-revisions | 12 (4 critical, 2 high, 5 medium, 1 taste pair) |
| DX | refactor-first | 10 (2 critical, 5 high, 2 medium, 1 taste). TTHW currently ∞; achievable 4 min after fixes. Scorecard 2/10 → 7.5/10. |

## Approach

**A + C in parallel.** Cold outreach (3 named users) + gstack-captive cohort (every gstack-brain v2 upgrader). 4-week sprint. Week 0 = upstream conversation with claude-mem maintainer. Weeks 1-2 = build + recruit + onboard. Week 3 = observe. Week 4 = retention check + moat decision. Deadline 2026-05-30.

## Moat statement (NEW from CEO review)

By end of week 4 the founder commits in writing to one of:
1. Trust + audit primitives that closed memory tools structurally cannot expose.
2. Cross-agent neutrality enforced by open governance.
3. Captive distribution through gstack.

"We'll figure it out later" is a fail.

## v0.1 surface (revised, deliberately tiny)

**Two MCP tools:**
```
memory_put({
  text: string,
  kind: "text",          // v0.1 ships ONE kind; let user data pick the name
  repo: string,          // auto-detected from cwd git-remote, falls back to "default"
  tags?: string[]
}) -> { id, created_at }

memory_search({
  query: string,         // lexical; no embeddings yet
  repo: string,
  limit?: number         // default 5
}) -> Array<{ id, text, kind, tags, created_at, score }>
```

**Storage row:** `entries { id PK, repo, kind, text, tags JSON, created_at, last_used_at }`. PGLite single-backend.

**Four CLI commands:** `serve`, `doctor`, `status`, `version`. Everything else is deferred to `_deferred/`.

**Cuts (deferred, kept on disk):** sync layer, trust tiers, decay engine, all entry kinds beyond one, Postgres backend, embeddings, reranker, audit tooling. The 27 source files / 1,786 LOC of scaffold stays — but only ~250-600 LOC participate in the v0.1 surface.

**Honest LOC budget:** 400-600 LOC of new code (Eng review corrected the original 250-300 estimate).

## Critical fixes (must land before any user touches v0.1)

1. **Write `src/mcp/server.mjs` from scratch.** ~120-180 LOC. Stdio MCP transport with `memory_put` + `memory_search` only.
2. **Strip `dispatch.mjs` to 4 commands** (`serve`, `doctor`, `status`, `version`). Delete imports that reference vaporware paths.
3. **Fix SQL injection in `src/storage/repository.mjs:173, 258, 268`.** Convert string-concat to parameterized queries even though the file is deferred — defense-in-depth.
4. **Single-writer flock on `~/.shadowbrain/db/.lock`.** PGLite is single-process; parallel sessions corrupt the DB. Refuse to start if held; print incumbent PID.

## High-severity (fix before user 3)

5. **MCP error envelope.** `{ ok: true, results: [...] }` vs `{ ok: false, error: { code, message, hint } }`. Empty result is `{ ok: true, results: [] }`. Surface tsvector availability in `doctor`; tag `engine: 'like'` when fallback active.
6. **`kind: string` not enum** for v0.1. Canonical `dead_end` (underscore). Drop `KIND_WEIGHT` rerank entirely from v0.1.

## Medium-severity (fix or document)

7. **JSONL observation log: opt-in via `SHADOWBRAIN_OBSERVE=1`.** Logs only `{timestamp, tool, success, latency_ms, result_count}`. No query content, no entry text. 10MB rotation cap.
8. **Quarantine v0.5+ tests** (`pii.test.mjs`, `secrets.test.mjs`, `trust.test.mjs`, `normalizer.test.mjs`, integration `repository.test.mjs`) to `test/_deferred/`. Exclude from `npm test`.
9. **Use `claude mcp add` CLI in README**, not file paste. Test on macOS + Linux. Skip Claude Desktop.
10. **Cold-start metric in `doctor`.** Print PGLite open + migrate time on first run.
11. **Wrap retrieved entries with `<shadowbrain-entry>...</shadowbrain-entry>` delimiter.** MCP tool description tells the agent these are user-supplied data, not instructions. Document threat model.

## Taste decisions (resolved option A at final gate)

- **#19:** Write slim v0.1 repo (~80 LOC); ignore existing 493-LOC Repository until v0.5.
- **#20:** flock + clear error + document single-session limit (cheapest, most honest).
- **#29:** JSONL default-off; README has TWO install snippets (early-user mode `-e SHADOWBRAIN_OBSERVE=1` vs private mode).

## Cross-phase themes (3 high-confidence signals)

1. **"Scaffold reuse" was a sunk-cost story.** Convergent across CEO/Eng/DX. The existing scaffold is half-finished v0.5 machinery, not a v0.1 foundation. Honest framing: delete most, keep schema + PGLite wrapper, write the v0.1 surface from scratch. (We're not deleting — we're moving to `_deferred/`.)

2. **The founder will be blind without observation.** Retention gate + JSONL default + redaction all touch the same lever. Without an opt-in-by-default-for-early-cohort log, the success criteria are unmeasurable.

3. **v0.1 surface area is at the credibility floor.** 2 tools, no `memory_get`, no `memory_list`, no auto-detect. Right call for testing P1; needs explicit "v0.2 has X" answer for users 4+.

## Success criteria (revised, week-4 gates)

1. **Install gate:** 3+ cold-outreach users meeting the user definition.
2. **Retention gate (NEW):** ≥2 of cold cohort used unprompted in week 4 (founder doesn't message — checks JSONL log + asks after the fact).
3. **Quote gate:** ≥1 verbatim quote of a moment Shadowbrain saved re-deriving context.
4. **Surprise gate:** ≥1 user does something with Shadowbrain you didn't design for.
5. **Reflection gate:** 200-word post-mortem per cold-outreach user.
6. **Moat decision (NEW):** founder commits in writing to one moat candidate.
7. **Decision:** Cut / pivot / scale.

**Kill criteria:** <3 cold installs by week 3 OR zero quotes by week 4 OR zero week-4 retention OR <2 of 3 emit `memory_put` in weeks 1-3.

## v0.5 commercial wedge (decide if v0.1 validates)

1. Hosted sync as paid service (free local).
2. Trust + audit primitives behind paid plan (regulated industries).
3. Managed embeddings + reranker (large-volume teams).

License v0.5 commercial layer as BSL or similar source-available; keep OSS core MIT.

## Decision audit trail

29 decisions: 1 user-gate (D8 premise gate, accept-all chosen), 26 auto-decided per principles, 3 taste decisions (all resolved option A at D9 final gate), 0 user challenges. Full table lives in the design doc on Moorthy's machine; key entries are reflected in the build via the items above.
