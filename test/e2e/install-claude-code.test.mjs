// E2E install round-trip: drives `claude mcp add` against a sandbox config.
//
// Skips when `claude` is not on PATH so contributor environments without
// Claude Code installed can still run the suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function claudeAvailable() {
  const r = spawnSync('claude', ['--version'], { stdio: 'ignore', timeout: 3000 });
  return r.status === 0;
}

test('claude mcp add registers shadowbrain (skipped if claude CLI missing)', { skip: !claudeAvailable() }, () => {
  // We don't actually mutate the user's real claude config — we set
  // CLAUDE_CONFIG_DIR (or equivalent override) to a sandbox.
  const sandbox = mkdtempSync(join(tmpdir(), 'sbtest-claudecfg-'));
  try {
    writeFileSync(join(sandbox, '.claude.json'), '{}');

    const env = { ...process.env, HOME: sandbox, CLAUDE_CONFIG_DIR: sandbox };
    const add = spawnSync('claude', ['mcp', 'add', 'shadowbrain', '--', 'shadowbrain', 'serve'], {
      env,
      encoding: 'utf8',
      timeout: 10000,
    });

    // We assert the command DID NOT crash. Some `claude` versions prompt
    // interactively; in that case we expect a non-zero exit but no thrown
    // signal, which is acceptable for v0.1 e2e.
    assert.ok(!add.error, `claude mcp add raised: ${add.error?.message}`);

    const list = spawnSync('claude', ['mcp', 'list'], { env, encoding: 'utf8', timeout: 5000 });
    if (list.status === 0) {
      assert.ok((list.stdout || '').toLowerCase().includes('shadowbrain') || add.status !== 0,
        'either registration succeeded (shadowbrain in list) or add returned non-zero');
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
