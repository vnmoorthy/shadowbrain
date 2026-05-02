# Claude Code + Shadowbrain

A 5-minute walkthrough.

## Install

```bash
# from npm
npm install -g shadowbrain
claude mcp add shadowbrain -- shadowbrain serve

# OR from the install.sh
curl -fsSL https://raw.githubusercontent.com/vnmoorthy/shadowbrain/main/install.sh | bash
```

Verify:

```bash
shadowbrain doctor
claude mcp list | grep shadowbrain
```

## Grant the current repo

`memory_put` against an unknown repo returns `WRITE_DENIED`. Grant once:

```bash
shadowbrain trust set $(git config --get remote.origin.url) --tier read-write
```

## Run a two-session test

**Session A** (in your repo's directory, `claude` running):

> Find the JWT verification code and remember that we standardize on the `jose` library, not `jsonwebtoken`. Use `memory_put`.

Claude calls `memory_put` with kind `pattern`, topic `auth`, and an explanation. You see:

```
{ ok: true, entry: { id: "019de...", repo: "github.com/youruser/yourrepo", ... } }
```

**Session B** (new `claude` session in the same repo):

> What library do we use for JWT?

Claude calls `memory_search` for "JWT library", gets the entry from Session A, answers correctly.

## Composing with `/retro` (gstack)

If you run gstack, add a one-liner to your `/retro` skill that calls `memory_put` for each non-trivial learning. The autoplan in `docs/REVIEWS/autoplan.md` documents the pattern.

## Troubleshooting

- **"another shadowbrain process holds the database lock"** — only one Claude Code session can write to the DB at a time. Close the older session, or run `lsof ~/.shadowbrain/serve.lock` to find the holder.
- **"WRITE_DENIED"** — run `shadowbrain trust set <repo> --tier read-write`.
- **"SECRET_DETECTED"** — your entry contained a credential. Redact and retry.
- **`claude mcp add` reports "already registered"** — that's fine. Use `claude mcp remove shadowbrain` first if you want to start over.
