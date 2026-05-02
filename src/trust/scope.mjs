// Repo + scope detection from cwd.
//
// Walks up from cwd to find:
//   1. The git remote (origin's url) → canonical repo URL
//   2. Whether we're inside a worktree, submodule, or monorepo subpath
//   3. The package boundary inside a monorepo
//
// We do this without shelling out to git — read .git/config directly and
// fall back to GIT_DIR / .git pointer files for worktrees and submodules.

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { canonicalizeRemote } from './policy.mjs';

/**
 * Resolve the repo + scope for a given cwd.
 *
 * @param {string} cwd
 * @returns {{ canonicalUrl: string, scope: string|null, kind: 'plain'|'worktree'|'submodule'|'monorepo'|'none' }}
 */
export function resolveRepoScope(cwd = process.cwd()) {
  const root = findRepoRoot(cwd);
  if (!root) return { canonicalUrl: '', scope: null, kind: 'none' };
  const canonicalUrl = readRemoteUrl(root) || '';
  const monoroot = detectMonorepoRoot(root);
  let scope = null;
  let kind = 'plain';

  // worktree pointer: .git is a file pointing to the gitdir of the parent
  const dotgit = join(root, '.git');
  if (existsSync(dotgit) && statSync(dotgit).isFile()) {
    kind = 'worktree';
  }

  // submodule pointer: .git/config or HEAD references gitdir of the parent
  const gitConfig = readGitConfig(root);
  if (gitConfig?.includes('[submodule')) {
    kind = 'submodule';
  }

  // monorepo subpath
  if (monoroot && monoroot.scopes.length > 0) {
    const rel = relative(root, cwd);
    const match = monoroot.scopes.find((s) => rel === s || rel.startsWith(s + '/'));
    if (match) {
      scope = match;
      kind = 'monorepo';
    }
  }

  return { canonicalUrl: canonicalizeRemote(canonicalUrl), scope, kind };
}

export function findRepoRoot(start) {
  let cur = resolve(start);
  while (true) {
    if (existsSync(join(cur, '.git'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function readGitConfig(root) {
  const p = join(root, '.git', 'config');
  if (!existsSync(p) || !statSync(p).isFile()) return null;
  return readFileSync(p, 'utf8');
}

export function readRemoteUrl(root, name = 'origin') {
  const cfg = readGitConfig(root);
  if (!cfg) return null;
  // Walk INI sections.
  const sections = cfg.split(/\n(?=\[)/);
  for (const sec of sections) {
    const header = sec.match(/^\[remote "([^"]+)"\]/);
    if (header && header[1] === name) {
      const url = sec.match(/url\s*=\s*(.+)/);
      if (url) return url[1].trim();
    }
  }
  return null;
}

/**
 * Detect monorepo type and enumerate package scopes (path prefixes relative
 * to repo root).
 */
export function detectMonorepoRoot(root) {
  const out = { type: null, scopes: [] };

  // npm/yarn/pnpm: package.json with workspaces, OR pnpm-workspace.yaml.
  const pkgJson = readJsonIfExists(join(root, 'package.json'));
  if (pkgJson?.workspaces) {
    out.type = 'npm';
    out.scopes = expandWorkspaces(pkgJson.workspaces, root);
  }
  if (existsSync(join(root, 'pnpm-workspace.yaml'))) {
    out.type = out.type || 'pnpm';
    try {
      const text = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
      const m = text.match(/packages:\s*\n((?:\s*-\s*[^\n]+\n)+)/);
      if (m) {
        const lines = m[1].split('\n').filter(Boolean).map((l) => l.replace(/^\s*-\s*['"]?|['"]?$/g, '').trim());
        out.scopes = [...new Set([...out.scopes, ...expandGlobs(lines, root)])];
      }
    } catch {}
  }
  // Nx
  if (existsSync(join(root, 'nx.json'))) {
    out.type = out.type || 'nx';
  }
  // Turbo
  if (existsSync(join(root, 'turbo.json'))) {
    out.type = out.type || 'turbo';
  }
  // Cargo workspace
  const cargoToml = readTextIfExists(join(root, 'Cargo.toml'));
  if (cargoToml && /\[workspace\]/.test(cargoToml)) {
    out.type = out.type || 'cargo';
    const m = cargoToml.match(/\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/);
    if (m) {
      const items = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      out.scopes = [...new Set([...out.scopes, ...expandGlobs(items, root)])];
    }
  }
  // Go workspace
  const goWork = readTextIfExists(join(root, 'go.work'));
  if (goWork) {
    out.type = out.type || 'go';
    const m = goWork.match(/use\s*\(([\s\S]*?)\)/);
    if (m) {
      const items = m[1].split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !l.startsWith('//'));
      out.scopes = [...new Set([...out.scopes, ...items])];
    } else {
      const single = goWork.match(/use\s+(\S+)/);
      if (single) out.scopes.push(single[1]);
    }
  }
  return out.type ? out : null;
}

function readJsonIfExists(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}
function readTextIfExists(p) {
  if (!existsSync(p)) return null;
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function expandWorkspaces(ws, root) {
  const arr = Array.isArray(ws) ? ws : Array.isArray(ws.packages) ? ws.packages : [];
  return expandGlobs(arr, root);
}

// Tiny path-glob expansion. We only honor the trailing `*` shape commonly
// seen in workspace declarations (e.g. "packages/*", "apps/*"). Any glob
// without a trailing `/*` is treated as a literal path.
function expandGlobs(patterns, root) {
  const out = new Set();
  for (const pat of patterns) {
    if (pat.endsWith('/*')) {
      const prefix = pat.slice(0, -2);
      const dirAbs = join(root, prefix);
      if (!existsSync(dirAbs)) continue;
      try {
        for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
          if (entry.isDirectory()) out.add(`${prefix}/${entry.name}`);
        }
      } catch {}
    } else {
      out.add(pat);
    }
  }
  return [...out];
}
