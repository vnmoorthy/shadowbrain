import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRepoV01 } from '../../src/storage/repository-v01.mjs';
import { withTmpHome } from '../_helpers/tmp-home.mjs';

test('repository-v01: put returns id + created_at', withTmpHome(async () => {
  const repo = await openRepoV01({ ephemeral: true });
  try {
    const r = await repo.put({ text: 'use pnpm not npm', repo: 'github.com/foo/bar' });
    assert.match(r.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.ok(r.created_at);
  } finally {
    await repo.close();
  }
}));

test('repository-v01: put + search round-trip', withTmpHome(async () => {
  const repo = await openRepoV01({ ephemeral: true });
  try {
    await repo.put({ text: 'use pnpm not npm', repo: 'r1' });
    const out = await repo.search({ query: 'pnpm', repo: 'r1' });
    assert.equal(out.engine, 'like');
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].text, 'use pnpm not npm');
    assert.equal(out.results[0].kind, 'gotcha');
    assert.deepEqual(out.results[0].tags, []);
  } finally {
    await repo.close();
  }
}));

test('repository-v01: search returns empty array when no match (does NOT throw)', withTmpHome(async () => {
  const repo = await openRepoV01({ ephemeral: true });
  try {
    const out = await repo.search({ query: 'nonexistent', repo: 'r1' });
    assert.equal(out.results.length, 0);
    assert.equal(out.engine, 'like');
  } finally {
    await repo.close();
  }
}));

test('repository-v01: search returns empty when DB is empty', withTmpHome(async () => {
  const repo = await openRepoV01({ ephemeral: true });
  try {
    const out = await repo.search({ query: 'anything', repo: 'r1' });
    assert.equal(out.results.length, 0);
  } finally {
    await repo.close();
  }
}));

test('repository-v01: scoped to repo (no cross-repo bleed)', withTmpHome(async () => {
  const repo = await openRepoV01({ ephemeral: true });
  try {
    await repo.put({ text: 'use pnpm', repo: 'github.com/foo/a' });
    await repo.put({ text: 'use yarn', repo: 'github.com/foo/b' });
    const a = await repo.search({ query: 'pnpm', repo: 'github.com/foo/a' });
    const b = await repo.search({ query: 'pnpm', repo: 'github.com/foo/b' });
    assert.equal(a.results.length, 1);
    assert.equal(b.results.length, 0);
  } finally {
    await repo.close();
  }
}));

test('repository-v01: put rejects empty/missing text', withTmpHome(async () => {
  const repo = await openRepoV01({ ephemeral: true });
  try {
    await assert.rejects(() => repo.put({ text: '', repo: 'r1' }), /text is required/);
    await assert.rejects(() => repo.put({ repo: 'r1' }), /text is required/);
    await assert.rejects(() => repo.put({ text: 'x' }), /repo is required/);
  } finally {
    await repo.close();
  }
}));

test('repository-v01: tags persist as array', withTmpHome(async () => {
  const repo = await openRepoV01({ ephemeral: true });
  try {
    await repo.put({ text: 'tagged note', repo: 'r1', tags: ['a', 'b', 'c'] });
    const out = await repo.search({ query: 'tagged', repo: 'r1' });
    assert.deepEqual(out.results[0].tags, ['a', 'b', 'c']);
  } finally {
    await repo.close();
  }
}));

test('repository-v01: ILIKE escapes wildcards in query', withTmpHome(async () => {
  // A user search for "100%" should not be reinterpreted as "any-string".
  const repo = await openRepoV01({ ephemeral: true });
  try {
    await repo.put({ text: 'covered 100% of the cases', repo: 'r1' });
    await repo.put({ text: 'unrelated content', repo: 'r1' });
    const out = await repo.search({ query: '100%', repo: 'r1' });
    assert.equal(out.results.length, 1);
    assert.match(out.results[0].text, /100%/);
  } finally {
    await repo.close();
  }
}));

test('repository-v01: limit caps at 50', withTmpHome(async () => {
  const repo = await openRepoV01({ ephemeral: true });
  try {
    for (let i = 0; i < 5; i++) {
      await repo.put({ text: `entry ${i} match`, repo: 'r1' });
    }
    const out = await repo.search({ query: 'match', repo: 'r1', limit: 1000 });
    assert.ok(out.results.length <= 50);
  } finally {
    await repo.close();
  }
}));

test('repository-v01: count by repo', withTmpHome(async () => {
  const repo = await openRepoV01({ ephemeral: true });
  try {
    await repo.put({ text: 'a', repo: 'r1' });
    await repo.put({ text: 'b', repo: 'r1' });
    await repo.put({ text: 'c', repo: 'r2' });
    assert.equal(await repo.count({ repo: 'r1' }), 2);
    assert.equal(await repo.count({ repo: 'r2' }), 1);
    assert.equal(await repo.count(), 3);
  } finally {
    await repo.close();
  }
}));
