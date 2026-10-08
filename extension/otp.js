// Offline unlock codes shared by the PWA and the extension.
// KEEP IN SYNC with app/js/unlock.js (npm test checks they are identical).
//
// Both sides hold the same pairing secret. A code is HMAC-SHA256(secret, time window),
// truncated to 6 digits — the same idea as TOTP, so no server ever has to see anything.

export const WINDOW_SEC = 300;

// 32 symbols, no I/O/0/1 so pairing codes are easy to type.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newSecret(length = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export const normalizeSecret = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const formatSecret = (s) => (normalizeSecret(s).match(/.{1,4}/g) || []).join('-');

export const windowOf = (t = Date.now()) => Math.floor(t / 1000 / WINDOW_SEC);

export const windowEnd = (w) => (w + 1) * WINDOW_SEC * 1000;

export async function codeForWindow(secret, w) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(normalizeSecret(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`grassgate:${w}`)));
  const n = (((sig[0] & 0x7f) << 24) | (sig[1] << 16) | (sig[2] << 8) | sig[3]) % 1_000_000;
  return String(n).padStart(6, '0');
}

export const codeFor = (secret, t = Date.now()) => codeForWindow(secret, windowOf(t));

// Accepts the current and previous window, so a code lives 5–10 minutes.
export async function verifyCode(secret, code, t = Date.now()) {
  const clean = String(code || '').replace(/\D/g, '');
  if (clean.length !== 6) return false;
  const w = windowOf(t);
  for (const candidate of [w, w - 1]) {
    if ((await codeForWindow(secret, candidate)) === clean) return true;
  }
  return false;
}
