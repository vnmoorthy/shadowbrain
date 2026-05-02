# Trust Model

Shadowbrain memory propagates across machines and across agents. Trust is per-remote, sticky, and explicit.

## Three tiers

| Tier | read | write | When to use |
|---|---|---|---|
| `read-write` | ✓ | ✓ | Repos you and your team write to, where you trust the contributors |
| `read-only` | ✓ | ✗ | Public repos, repos you've been given access to but shouldn't pollute |
| `deny` | ✗ | ✗ | Repos where you don't want any cross-contamination — e.g. customer code on your machine |

## Default behavior

Unknown repos default to **read-allowed, write-denied**. Discovery (search, list) works without a decision. The first time an agent tries to write to an unknown repo, the MCP server returns `WRITE_DENIED` with a `fix:` hint:

```
shadowbrain trust set github.com/yourorg/yourrepo --tier read-write
```

This makes write-grants explicit and auditable.

If you'd rather get a prompt the first time you encounter a new remote, run `shadowbrain trust list` once and the prompt module will walk you through any pending decisions. (Non-tty contexts auto-deny by design — silent grants are a bad idea.)

## Repo identity

Two URLs that should be the same repo always normalize to the same canonical form. The normalizer:

- Lowercases the host.
- Strips protocol (`https://`, `git://`, `ssh://`).
- Strips embedded auth (`oauth2:TOKEN@`, `git@`).
- Strips port.
- Strips trailing `.git` and trailing slash.

Examples:

| Input | Canonical |
|---|---|
| `git@github.com:vnmoorthy/shadowbrain.git` | `github.com/vnmoorthy/shadowbrain` |
| `https://github.com/vnmoorthy/shadowbrain.git` | `github.com/vnmoorthy/shadowbrain` |
| `https://oauth2:TOKEN@github.com/vnmoorthy/shadowbrain` | `github.com/vnmoorthy/shadowbrain` |
| `ssh://git@gitlab.example.com:2222/team/svc.git` | `gitlab.example.com/team/svc` |

So `git config remote.origin.url` and `git config remote.fork.url` agree even when one is HTTPS and one is SSH.

## Inheritance

- **Worktrees** inherit their parent's tier. A worktree's `.git` file points at the parent's gitdir; we follow it.
- **Submodules** inherit the parent's tier. Memory writes from inside a submodule go to the *parent's* namespace by default. Explicit per-submodule scoping is supported via `scope:` in the MCP call.
- **Forks** are a different repo from the upstream. If you fork `acme/api` to `me/api`, they're separate canonical URLs and need separate trust decisions.

## Monorepo scoping

Inside a monorepo, the v0.5 retriever applies a `scope` filter that defaults to the package boundary. Detection is automatic for:

- npm/yarn `package.json` `workspaces`
- `pnpm-workspace.yaml`
- `nx.json`, `turbo.json`
- Cargo `[workspace] members`
- `go.work`

Inside `monorepo/packages/web`, a search returns entries scoped to `packages/web` (plus entries explicitly tagged `shared`). Writes default to the same scope. To search the whole monorepo, pass `scope: ""` (empty string) explicitly.

## The trust file

`~/.shadowbrain/trust.yaml`:

```yaml
version: 1
remotes:
  github.com/acme/api:
    tier: read-write
    decided_at: 2026-04-15T11:42:00Z
  github.com/acme/billing:
    tier: read-only
    decided_at: 2026-04-15T11:42:00Z
  github.com/external/customer-x:
    tier: deny
    decided_at: 2026-04-20T09:00:00Z
    reason: customer code, no cross-contamination
monorepos:
  github.com/acme/web:
    type: npm
    scopes:
      - packages/app1
      - packages/app2
```

File mode is `0600`. Edit by hand or via `shadowbrain trust set/remove`.

## What happens on a tier change

- `read-write` → `read-only`: existing entries stay; future writes blocked. No retroactive deletion.
- Any → `deny`: search/get/list also blocked. Existing entries stay on disk and are restored if the tier is later upgraded.
- `deny` → `read-write`: existing entries become visible again; the decision is logged in the audit trail.

## What this is NOT

- It is not a replacement for git permissions. A `read-write` tier means *you* trust the repo's authorship, not that the agent has push access to the actual code.
- It is not multi-user (per-user-on-this-machine) for v0.5. Multiple humans on one machine share one `~/.shadowbrain/trust.yaml`.
