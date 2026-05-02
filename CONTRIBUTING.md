# Contributing

Thanks for considering a contribution. This project is small and the bar is high.

## Before you write code

- Read `docs/ARCHITECTURE.md` and `docs/PROTOCOL.md`.
- Read `docs/REVIEWS/autoplan.md` for the build's design constraints.
- For non-trivial changes, open an issue first describing what and why.

## Setting up

```bash
git clone https://github.com/vnmoorthy/shadowbrain.git
cd shadowbrain
npm install
npm test           # 60+ tests across unit + integration
node bin/shadowbrain.mjs --help
```

## Running the test suite

```bash
npm test                   # unit + integration
npm run test:e2e           # spawns the MCP server, drives stdio frames
npm run test:gold          # the precision@5 gate
npm run audit:no-outbound  # grep-verifies no surprise network calls
```

A passing PR keeps `npm test` green and `precision@5 >= 0.90` on the gold set.

## Style

- ESM only. `.mjs` everywhere.
- `node:` prefix on all built-in imports.
- No `require()` inside ESM files.
- Biome handles formatting + lint. `npm run lint:fix` before committing.
- Comments explain *why*, not *what*. Names cover the *what*.
- Errors thrown to humans should be `ShadowbrainError` subclasses with `code`, `message`, `fix`, `docs_url`.

## Commit messages

Conventional commits help future-us auto-generate the changelog:

```
feat(retrieval): bump kind weight for dead_end entries
fix(sync): merge tag arrays even on equal lamports
docs: clarify trust tier semantics for forks
```

## What we won't merge

- Changes that add outbound network calls without an opt-in env var and a CI audit-no-outbound update.
- Changes that bypass the trust check.
- Changes that store secrets even in opt-in mode. The scanner is non-negotiable.
- Heavyweight deps. Every new dep needs justification in the PR description.
- Changes that drop `precision@5 < 0.90` on the gold set.

## Reporting security issues

See `docs/SECURITY.md`. Don't open public issues for vulnerabilities.
