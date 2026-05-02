import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanForPII } from '../../src/ingest/pii.mjs';

test('email — warn by default', () => {
  const f = scanForPII('contact alice@example.com for help');
  assert.equal(f.find((x) => x.kind === 'email').severity, 'warn');
});

test('phone — warn by default', () => {
  const f = scanForPII('call 415-555-0100');
  assert.equal(f.find((x) => x.kind === 'phone').severity, 'warn');
});

test('SSN — block by default', () => {
  const f = scanForPII('ssn 123-45-6789 was leaked');
  assert.equal(f.find((x) => x.kind === 'ssn').severity, 'block');
});

test('credit card — Luhn-checked, valid card flagged', () => {
  // Visa test card: 4242424242424242
  const f = scanForPII('charge 4242 4242 4242 4242 with idempotency key');
  assert.ok(f.find((x) => x.kind === 'credit_card'));
});

test('credit card — Luhn rejects random 16 digits', () => {
  const f = scanForPII('account number 1234567890123456 in legacy db');
  assert.equal(f.filter((x) => x.kind === 'credit_card').length, 0);
});

test('policy override — turn off email scanning per repo', () => {
  const f = scanForPII('alice@example.com', { email: 'off' });
  assert.equal(f.find((x) => x.kind === 'email'), undefined);
});

test('policy override — escalate phone to block', () => {
  const f = scanForPII('call 415-555-0100', { phone: 'block' });
  assert.equal(f.find((x) => x.kind === 'phone').severity, 'block');
});

test('redacts the sample', () => {
  const f = scanForPII('user 123-45-6789 SSN');
  const ssn = f.find((x) => x.kind === 'ssn');
  assert.match(ssn.sample, /\*\*\*/);
});

test('does not flag innocuous text', () => {
  const f = scanForPII('use jose for JWT — see RFC 7519');
  assert.equal(f.length, 0);
});

test('IPv4 — off by default, can be enabled', () => {
  const f1 = scanForPII('server at 10.0.0.1');
  assert.equal(f1.find((x) => x.kind === 'ipv4'), undefined);
  const f2 = scanForPII('server at 10.0.0.1', { ipv4: 'warn' });
  assert.ok(f2.find((x) => x.kind === 'ipv4'));
});
