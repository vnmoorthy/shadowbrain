import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uuidv7, entryContentHash, newEntry, nextLamport, setLamport,
} from '../../src/schema/entry.mjs';
import { ENTRY_KINDS, KIND_WEIGHT, isEntryKind, KIND_FRESHNESS_DAYS } from '../../src/schema/kinds.mjs';
import { entrySchema, validateEntry, tryValidateEntry, MAX_BODY_TOKENS, approximateTokenCount } from '../../src/schema/validators.mjs';

test('uuidv7 is well-formed and time-sortable across ms boundaries', async () => {
  const a = uuidv7();
  // sleep one millisecond so the timestamp prefix advances
  await new Promise((r) => setTimeout(r, 2));
  const b = uuidv7();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(a, b);
  assert.ok(a < b, 'uuidv7 generated later in time should sort > earlier');
});

test('uuidv7 — 1000 unique', () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(uuidv7());
  assert.equal(set.size, 1000);
});

test('content hash is stable across whitespace-only changes? no — it normalizes via JSON.stringify', () => {
  const a = entryContentHash({ repo: 'r', scope: null, topic: 't', kind: 'pattern', title: 'x', body: 'b' });
  const b = entryContentHash({ repo: 'r', scope: null, topic: 't', kind: 'pattern', title: 'x', body: 'b' });
  assert.equal(a, b);
  const c = entryContentHash({ repo: 'r', scope: null, topic: 't', kind: 'pattern', title: 'x', body: 'b changed' });
  assert.notEqual(a, c);
});

test('content hash uses trimmed title/body', () => {
  const a = entryContentHash({ repo: 'r', topic: 't', kind: 'p', title: 'x', body: 'b' });
  const b = entryContentHash({ repo: 'r', topic: 't', kind: 'p', title: '  x  ', body: '\n\nb\n' });
  assert.equal(a, b);
});

test('newEntry fills all required defaults', () => {
  const e = newEntry({ repo: 'r', topic: 't', kind: 'pattern', title: 'x', body: 'y' });
  assert.ok(e.id);
  assert.equal(e.confidence, 0.7);
  assert.deepEqual(e.context.tags, []);
  assert.equal(e.use_count, 0);
  assert.equal(e.deleted, false);
});

test('Lamport monotonicity', () => {
  setLamport(0);
  const a = nextLamport();
  const b = nextLamport();
  assert.equal(b, a + 1);
});

test('Lamport setter takes max', () => {
  setLamport(100);
  setLamport(50);
  const next = nextLamport();
  assert.ok(next > 100);
});

test('ENTRY_KINDS contains all spec kinds', () => {
  for (const k of ['decision','pattern','anti_pattern','gotcha','dead_end','convention','integration','deployment','glossary','todo']) {
    assert.ok(isEntryKind(k), `missing ${k}`);
  }
  assert.equal(isEntryKind('not_a_kind'), false);
});

test('KIND_WEIGHT puts gotcha above pattern', () => {
  assert.ok(KIND_WEIGHT.gotcha > KIND_WEIGHT.pattern);
  assert.ok(KIND_WEIGHT.anti_pattern > KIND_WEIGHT.pattern);
});

test('KIND_FRESHNESS_DAYS — todo stales fast, decision lasts forever', () => {
  assert.ok(KIND_FRESHNESS_DAYS.todo < KIND_FRESHNESS_DAYS.pattern);
  assert.ok(KIND_FRESHNESS_DAYS.decision >= 365);
});

test('validateEntry rejects bad UUID', () => {
  const e = newEntry({ repo: 'r', topic: 't', kind: 'pattern', title: 'x', body: 'y' });
  e.id = 'not-a-uuid';
  assert.throws(() => validateEntry(e));
});

test('validateEntry passes for newEntry', () => {
  const e = newEntry({ repo: 'r', topic: 't', kind: 'pattern', title: 'x', body: 'y' });
  validateEntry(e);
});

test('tryValidateEntry — success', () => {
  const e = newEntry({ repo: 'r', topic: 't', kind: 'pattern', title: 'x', body: 'y' });
  const res = tryValidateEntry(e);
  assert.equal(res.ok, true);
  assert.ok(res.value);
});

test('tryValidateEntry — failure returns error object', () => {
  const res = tryValidateEntry({ id: 'bad' });
  assert.equal(res.ok, false);
  assert.ok(res.error);
});

test('approximateTokenCount near zero', () => {
  assert.equal(approximateTokenCount(''), 0);
  assert.ok(approximateTokenCount('hello world') > 0);
});

test('MAX_BODY_TOKENS is 4000', () => {
  assert.equal(MAX_BODY_TOKENS, 4000);
});
