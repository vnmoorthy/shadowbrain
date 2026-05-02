import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalizeRemote, validTier, canonicalAllowed, TIERS } from '../../src/trust/policy.mjs';
import { loadTrustStore, saveTrustStore } from '../../src/trust/store.mjs';
import { resolveRepoScope, readRemoteUrl, detectMonorepoRoot } from '../../src/trust/scope.mjs';

test('canonicalize HTTPS', () => {
  assert.equal(canonicalizeRemote('https://github.com/vnmoorthy/shadowbrain.git'), 'github.com/vnmoorthy/shadowbrain');
});

test('canonicalize SSH', () => {
  assert.equal(canonicalizeRemote('git@github.com:vnmoorthy/shadowbrain.git'), 'github.com/vnmoorthy/shadowbrain');
});

test('canonicalize ssh:// scheme', () => {
  assert.equal(canonicalizeRemote('ssh://git@github.com/vnmoorthy/shadowbrain'), 'github.com/vnmoorthy/shadowbrain');
});

test('canonicalize strips embedded auth', () => {
  assert.equal(canonicalizeRemote('https://oauth2:TOKEN@github.com/vnmoorthy/shadowbrain.git'), 'github.com/vnmoorthy/shadowbrain');
});

test('canonicalize strips port', () => {
  assert.equal(canonicalizeRemote('https://gitlab.example.com:8443/team/app.git'), 'gitlab.example.com/team/app');
});

test('canonicalize lowercases host but not path', () => {
  assert.equal(canonicalizeRemote('https://GitHub.com/Org/RepoName.git'), 'github.com/Org/RepoName');
});

test('canonicalize is idempotent', () => {
  const a = canonicalizeRemote('https://github.com/x/y.git');
  const b = canonicalizeRemote(a);
  assert.equal(a, b);
});

test('validTier and TIERS', () => {
  assert.deepEqual([...TIERS], ['read-write', 'read-only', 'deny']);
  assert.ok(validTier('read-write'));
  assert.ok(!validTier('write-only'));
});

test('canonicalAllowed — unknown remote: read yes, write no', () => {
  const store = { remotes: {} };
  assert.equal(canonicalAllowed(store, 'github.com/x/y', 'read'), true);
  assert.equal(canonicalAllowed(store, 'github.com/x/y', 'write'), false);
});

test('canonicalAllowed — read-write tier', () => {
  const store = { remotes: { 'github.com/x/y': { tier: 'read-write' } } };
  assert.equal(canonicalAllowed(store, 'github.com/x/y', 'read'), true);
  assert.equal(canonicalAllowed(store, 'github.com/x/y', 'write'), true);
});

test('canonicalAllowed — read-only tier', () => {
  const store = { remotes: { 'github.com/x/y': { tier: 'read-only' } } };
  assert.equal(canonicalAllowed(store, 'github.com/x/y', 'read'), true);
  assert.equal(canonicalAllowed(store, 'github.com/x/y', 'write'), false);
});

test('canonicalAllowed — deny tier', () => {
  const store = { remotes: { 'github.com/x/y': { tier: 'deny' } } };
  assert.equal(canonicalAllowed(store, 'github.com/x/y', 'read'), false);
  assert.equal(canonicalAllowed(store, 'github.com/x/y', 'write'), false);
});

test('save and reload trust store', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sb-trust-'));
  const path = join(tmp, 'trust.yaml');
  await saveTrustStore({
    path,
    remotes: { 'github.com/x/y': { tier: 'read-write', decided_at: '2026-01-01T00:00:00Z' } },
  });
  const loaded = await loadTrustStore(path);
  assert.equal(loaded.remotes['github.com/x/y'].tier, 'read-write');
  rmSync(tmp, { recursive: true, force: true });
});

test('resolveRepoScope detects plain repo', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sb-scope-'));
  mkdirSync(join(tmp, '.git'), { recursive: true });
  writeFileSync(join(tmp, '.git', 'config'), `[remote "origin"]\n\turl = https://github.com/x/y.git\n`);
  const r = resolveRepoScope(tmp);
  assert.equal(r.canonicalUrl, 'github.com/x/y');
  assert.equal(r.kind, 'plain');
  rmSync(tmp, { recursive: true, force: true });
});

test('resolveRepoScope detects npm monorepo and scopes', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sb-mono-'));
  mkdirSync(join(tmp, '.git'), { recursive: true });
  writeFileSync(join(tmp, '.git', 'config'), `[remote "origin"]\n\turl = https://github.com/x/y.git\n`);
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
  mkdirSync(join(tmp, 'packages', 'app1'), { recursive: true });
  mkdirSync(join(tmp, 'packages', 'app2'), { recursive: true });
  const r = resolveRepoScope(join(tmp, 'packages', 'app1'));
  assert.equal(r.canonicalUrl, 'github.com/x/y');
  assert.equal(r.scope, 'packages/app1');
  assert.equal(r.kind, 'monorepo');
  rmSync(tmp, { recursive: true, force: true });
});

test('detectMonorepoRoot — pnpm', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sb-pnpm-'));
  writeFileSync(join(tmp, 'pnpm-workspace.yaml'), `packages:\n  - 'apps/*'\n  - 'libs/*'\n`);
  mkdirSync(join(tmp, 'apps', 'web'), { recursive: true });
  mkdirSync(join(tmp, 'libs', 'core'), { recursive: true });
  const m = detectMonorepoRoot(tmp);
  assert.equal(m.type, 'pnpm');
  assert.ok(m.scopes.includes('apps/web'));
  assert.ok(m.scopes.includes('libs/core'));
  rmSync(tmp, { recursive: true, force: true });
});

test('detectMonorepoRoot — turbo + nx', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sb-turbo-'));
  writeFileSync(join(tmp, 'turbo.json'), '{}');
  writeFileSync(join(tmp, 'nx.json'), '{}');
  const m = detectMonorepoRoot(tmp);
  assert.ok(['turbo', 'nx'].includes(m.type));
  rmSync(tmp, { recursive: true, force: true });
});

test('detectMonorepoRoot — cargo workspace', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sb-cargo-'));
  writeFileSync(join(tmp, 'Cargo.toml'), `[workspace]\nmembers = ["crates/a", "crates/b"]\n`);
  const m = detectMonorepoRoot(tmp);
  assert.equal(m.type, 'cargo');
  assert.deepEqual(m.scopes, ['crates/a', 'crates/b']);
  rmSync(tmp, { recursive: true, force: true });
});

test('detectMonorepoRoot — go workspace', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sb-go-'));
  writeFileSync(join(tmp, 'go.work'), `go 1.21\n\nuse (\n  ./svc-a\n  ./svc-b\n)\n`);
  const m = detectMonorepoRoot(tmp);
  assert.equal(m.type, 'go');
  assert.ok(m.scopes.includes('./svc-a'));
  rmSync(tmp, { recursive: true, force: true });
});

test('readRemoteUrl reads named remote', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sb-remote-'));
  mkdirSync(join(tmp, '.git'), { recursive: true });
  writeFileSync(join(tmp, '.git', 'config'), `[remote "origin"]\n\turl = git@github.com:foo/bar.git\n[remote "fork"]\n\turl = https://github.com/me/bar.git\n`);
  assert.equal(readRemoteUrl(tmp, 'origin'), 'git@github.com:foo/bar.git');
  assert.equal(readRemoteUrl(tmp, 'fork'), 'https://github.com/me/bar.git');
  rmSync(tmp, { recursive: true, force: true });
});
