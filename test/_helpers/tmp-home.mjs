// Per-test SHADOWBRAIN_HOME isolation.
//
// Every test that writes anything to disk gets its own temp home so the
// suite is parallelism-safe and cleans up after itself.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_HOME = process.env.SHADOWBRAIN_HOME;

export function withTmpHome(fn) {
  return async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'shadowbrain-test-'));
    process.env.SHADOWBRAIN_HOME = dir;
    try {
      return await fn(t, dir);
    } finally {
      process.env.SHADOWBRAIN_HOME = ORIGINAL_HOME;
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  };
}
