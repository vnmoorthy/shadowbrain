import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { withTmpHome } from '../_helpers/tmp-home.mjs';
import { recordToolEvent, setObserveEnabled, resetObservePath } from '../../src/observe.mjs';

test('observation log: default off — no file written', withTmpHome(async (_t, dir) => {
  setObserveEnabled(false);
  resetObservePath();
  recordToolEvent({ tool: 'memory_put', success: true, latency_ms: 1, result_count: 1 });
  assert.ok(!existsSync(join(dir, 'sessions.jsonl')), 'log file must not exist when disabled');
}));

test('observation log: enabled — writes single JSONL line', withTmpHome(async (_t, dir) => {
  setObserveEnabled(true);
  resetObservePath();
  recordToolEvent({ tool: 'memory_put', success: true, latency_ms: 12, result_count: 1 });
  const path = join(dir, 'sessions.jsonl');
  assert.ok(existsSync(path));
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0]);
  assert.equal(row.tool, 'memory_put');
  assert.equal(row.success, true);
  assert.equal(row.latency_ms, 12);
  assert.equal(row.result_count, 1);
  assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T/);
}));

test('observation log: NEVER logs query content or entry text', withTmpHome(async (_t, dir) => {
  // Even when callers accidentally pass extra fields, we must not write them.
  setObserveEnabled(true);
  resetObservePath();
  recordToolEvent({
    tool: 'memory_search',
    success: true,
    latency_ms: 5,
    result_count: 2,
    // Hostile extras that must NOT make it to disk:
    query: 'API_KEY=sk-1234567890',
    text: 'super secret',
    repo: 'private/repo',
  });
  const path = join(dir, 'sessions.jsonl');
  const content = readFileSync(path, 'utf8');
  assert.ok(!content.includes('API_KEY'), 'query content must not leak into log');
  assert.ok(!content.includes('sk-1234567890'), 'secrets must not leak into log');
  assert.ok(!content.includes('super secret'));
  assert.ok(!content.includes('private/repo'));
  // Sanity: we did write a row.
  assert.ok(content.includes('memory_search'));
}));

test('observation log: rotates at 10 MB cap', withTmpHome(async (_t, dir) => {
  // Pre-populate the log with > 10 MB of dummy content, then write one event
  // and assert the file was rotated to .1 and the new file is small.
  setObserveEnabled(true);
  resetObservePath();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'sessions.jsonl');
  // Write 11 MB of filler.
  const filler = 'x'.repeat(1024 * 1024);
  for (let i = 0; i < 11; i++) appendFileSync(path, filler);
  assert.ok(statSync(path).size > 10 * 1024 * 1024);

  recordToolEvent({ tool: 'memory_put', success: true, latency_ms: 1, result_count: 1 });

  assert.ok(existsSync(path));
  assert.ok(statSync(path).size < 1024, 'new log should be tiny after rotation');
  assert.ok(existsSync(`${path}.1`), 'old log should be preserved as .1');
}));
