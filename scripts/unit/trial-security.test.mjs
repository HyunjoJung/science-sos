import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validTrialToken, newTrialToken, trialSessionHash, trialIpHash } from '../../src/lib/trial/security.mjs';

test('trial sessions have 256-bit random opaque tokens and purpose-separated hashes', () => {
  const first = newTrialToken(), second = newTrialToken();
  assert.equal(validTrialToken(first), true);
  assert.notEqual(first, second);
  assert.match(trialSessionHash(first), /^[a-f0-9]{64}$/);
  assert.notEqual(trialSessionHash(first), first);
  assert.notEqual(trialSessionHash(first), trialSessionHash(second));
  for (const value of [null, undefined, '', 'x'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
    assert.equal(validTrialToken(value), false);
    assert.throws(() => trialSessionHash(value));
  }
});
test('only Vercel forwarded IP is accepted and hashed with a private server secret', () => {
  const a = new Headers({ 'x-forwarded-for': '192.0.2.1' });
  const b = new Headers({ 'x-forwarded-for': '192.0.2.2' });
  assert.equal(trialIpHash(a, 'key', false), trialIpHash(b, 'key', false));
  assert.notEqual(trialIpHash(a, 'key', true), trialIpHash(b, 'key', true));
  assert.notEqual(trialIpHash(a, 'key', true), trialIpHash(a, 'different', true));
  assert.equal(trialIpHash(new Headers({ 'x-forwarded-for': '192.0.2.1, spoof' }), 'key', true), trialIpHash(new Headers(), 'key', true));
  assert.throws(() => trialIpHash(a, '', true));
});
