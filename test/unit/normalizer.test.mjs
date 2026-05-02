import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../src/ingest/normalizer.mjs';

test('lowercases & snake-cases kind', () => {
  const e = normalize({ kind: 'Anti-Pattern' });
  assert.equal(e.kind, 'anti_pattern');
});

test('rejects unknown kind silently (leaves as-is so validator catches)', () => {
  const e = normalize({ kind: 'WHATEVER' });
  assert.equal(e.kind, 'WHATEVER');
});

test('coerces string tags to arrays', () => {
  const e = normalize({ context: { tags: 'a, b, c' } });
  assert.deepEqual(e.context.tags, ['a', 'b', 'c']);
});

test('null context fields become empty arrays', () => {
  const e = normalize({ context: { files: null, symbols: null, deps: null, tags: null } });
  assert.deepEqual(e.context.files, []);
  assert.deepEqual(e.context.symbols, []);
});

test('trims title and body', () => {
  const e = normalize({ title: '  hello  ', body: '\nworld\n' });
  assert.equal(e.title, 'hello');
  assert.equal(e.body, 'world');
});

test('clamps confidence to [0,1]', () => {
  assert.equal(normalize({ confidence: 1.5 }).confidence, 1);
  assert.equal(normalize({ confidence: -0.5 }).confidence, 0);
});
