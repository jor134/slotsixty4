/* Shared session helpers. Filenames starting with _ are not routed by Pages,
   so this is importable but never reachable as an endpoint.

   The session is an HMAC of its own expiry: "<expiry>.<signature>". Nothing
   secret lives in the cookie, and it can't be extended without SESSION_SECRET.
   Bindings expected: FAMILY_PASSWORD, SESSION_SECRET (secrets), ROMS (R2). */

const COOKIE = 's64';
const TTL = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value))));
}

/* Compares in time independent of where the first difference falls, so a
   response time can't be used to guess the password character by character. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function makeSession(env) {
  const exp = Math.floor(Date.now() / 1000) + TTL;
  return `${exp}.${await hmac(String(exp), env.SESSION_SECRET)}`;
}

export async function validSession(request, env) {
  const raw = request.headers.get('Cookie') || '';
  const hit = raw.split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (!hit) return false;
  const token = decodeURIComponent(hit.slice(COOKIE.length + 1));
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const exp = token.slice(0, dot), sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sig, await hmac(exp, env.SESSION_SECRET));
}

export function cookieHeader(token, maxAge) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; ` +
         `SameSite=Lax; Max-Age=${maxAge}`;
}

export function checkPassword(supplied, env) {
  return safeEqual(String(supplied || ''), String(env.FAMILY_PASSWORD || ''));
}

export const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }
  });
