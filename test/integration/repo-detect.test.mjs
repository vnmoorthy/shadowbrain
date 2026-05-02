import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectRepo } from '../../src/mcp/server.mjs';

test('repo auto-detect: from git remote URL (canonicalizes ssh + https)', () => {
  // Skip if `git` isn't on PATH.
  const which = spawnSync('git', ['--version'], { stdio: 'ignore' });
  if (which.status !== 0) return;

  const dir = mkdtempSync(join(tmpdir(), 'sbtest-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:foo/bar.git'], { cwd: dir });
    const r = detectRepo(dir);
    assert.equal(r, 'github.com/foo/bar');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repo auto-detect: falls back to directory basename when no git', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sbtest-fallback-'));
  try {
    const r = detectRepo(dir);
    // basename starts with 'sbtest-fallback-' (mkdtemp suffix); checking prefix is enough.
    assert.match(r, /^sbtest-fallback-/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
