import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanForSecrets, shannonEntropy } from '../../src/ingest/secrets.mjs';

test('detects AWS access key', () => {
  const f = scanForSecrets('AKIAIOSFODNN7EXAMPLE');
  assert.ok(f.length > 0);
  assert.equal(f[0].kind, 'aws_access_key');
});

test('detects GitHub PAT', () => {
  const f = scanForSecrets('ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789');
  assert.ok(f.find((x) => x.kind === 'github_pat_classic'));
});

test('detects OpenAI key', () => {
  const f = scanForSecrets('sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
  assert.ok(f.find((x) => x.kind === 'openai_key'));
});

test('detects Anthropic key', () => {
  const f = scanForSecrets('sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.ok(f.find((x) => x.kind === 'anthropic_key'));
});

test('detects Stripe live secret', () => {
  const f = scanForSecrets('sk' + '_live_' + 'aBcDeFgHiJkLmNoPqRsTuVwX');
  assert.ok(f.find((x) => x.kind === 'stripe_secret'));
});

test('detects PEM block', () => {
  const f = scanForSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----');
  assert.ok(f.find((x) => x.kind === 'pem_private_key'));
});

test('detects JWT', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const f = scanForSecrets(`token: ${jwt}`);
  assert.ok(f.find((x) => x.kind === 'jwt'));
});

test('detects high-entropy near "key=" marker', () => {
  const text = 'API_KEY=Ab9zXcvBnMqRsTuVwYz0123456789ABCDEF';
  const f = scanForSecrets(text);
  assert.ok(f.length > 0);
});

test('does not flag innocuous prose', () => {
  const f = scanForSecrets('we use jose for JWT verification, not jsonwebtoken');
  assert.equal(f.length, 0);
});

test('does not flag short uppercase strings', () => {
  const f = scanForSecrets('the constant FOO_BAR is in src/util.mjs');
  assert.equal(f.length, 0);
});

test('shannonEntropy — random string is high, repeated string is low', () => {
  const high = shannonEntropy('aB7xZ3qP9rT2vN');
  const low = shannonEntropy('aaaaaaaaaaaaaa');
  assert.ok(high > low);
});

test('redacts the matched sample', () => {
  const f = scanForSecrets('AKIAIOSFODNN7EXAMPLE');
  assert.match(f[0].sample, /\*\*\*/);
});

test('dedupes repeated findings', () => {
  const f = scanForSecrets('AKIAIOSFODNN7EXAMPLE AKIAIOSFODNN7EXAMPLE');
  // Same sample after redaction should dedupe.
  assert.equal(f.filter((x) => x.kind === 'aws_access_key').length, 1);
});
