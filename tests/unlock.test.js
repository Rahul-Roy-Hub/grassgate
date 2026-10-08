import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  newSecret, normalizeSecret, formatSecret, codeFor, codeForWindow, verifyCode, windowOf, WINDOW_SEC,
} from '../app/js/unlock.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const code = (src) => src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

test('app and extension share the exact same code generator and scenery', () => {
  assert.equal(code(read('../app/js/unlock.js')), code(read('../extension/otp.js')));
  assert.equal(code(read('../app/js/scenery.js')), code(read('../extension/scenery.js')));
});

test('secrets use the typeable alphabet and round-trip through formatting', () => {
  const s = newSecret();
  assert.match(s, /^[A-HJ-NP-Z2-9]{16}$/);
  assert.equal(normalizeSecret(formatSecret(s)), s);
  assert.equal(formatSecret('abcd efgh-jkmn'), 'ABCD-EFGH-JKMN');
});

test('codes are 6 digits, deterministic, and differ by secret', async () => {
  const t = Date.UTC(2026, 9, 8, 12, 0, 0);
  const a = await codeFor('ABCDEFGHJKMNPQRS', t);
  assert.match(a, /^\d{6}$/);
  assert.equal(a, await codeFor('abcd-efgh-jkmn-pqrs', t));
  assert.notEqual(a, await codeFor('ZZZZZZZZZZZZZZZZ', t));
});

test('a code is accepted in its window and the next, then expires', async () => {
  const secret = newSecret();
  const t = Date.now();
  const c = await codeFor(secret, t);
  const step = WINDOW_SEC * 1000;
  assert.ok(await verifyCode(secret, c, t));
  assert.ok(await verifyCode(secret, c.replace(/(\d{3})/, '$1 '), t), 'spaces are ignored');
  assert.ok(await verifyCode(secret, c, t + step));
  assert.equal(await verifyCode(secret, c, t + 2 * step), false);
  assert.equal(await verifyCode(secret, '12345', t), false);
});

test('window arithmetic', async () => {
  const w = windowOf(Date.UTC(2026, 0, 1));
  assert.equal(await codeForWindow('X'.repeat(16), w), await codeFor('X'.repeat(16), Date.UTC(2026, 0, 1)));
});
