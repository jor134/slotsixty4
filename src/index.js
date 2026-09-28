/* SLOT 64 — single Worker serving the app and gating the ROM bucket.

   Static files come from ./public via the ASSETS binding. /api/* is routed
   here first (run_worker_first in wrangler.jsonc) so nothing in the bucket is
   reachable without a valid session.

   Bindings: ROMS (R2), FAMILY_PASSWORD (secret), SESSION_SECRET (secret). */

import {
  checkPassword, makeSession, validSession, cookieHeader, json
} from './auth.js';

const ROM = /\.(z64|n64|v64|rom|zip)$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      return await route(request, env, url);
    } catch (err) {
      return json({ error: 'Server error: ' + (err && err.message) }, 500);
    }
  }
};

async function route(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/session' && method === 'GET')
    return json({ auth: await validSession(request, env) });

  if (path === '/api/login' && method === 'POST') {
    if (!env.FAMILY_PASSWORD || !env.SESSION_SECRET)
      return json({ error: 'Missing FAMILY_PASSWORD or SESSION_SECRET.' }, 500);
    let body = {};
    try { body = await request.json(); } catch (e) {}
    if (!checkPassword(body.password, env)) {
      await new Promise(r => setTimeout(r, 900)); // blunt brute-force tax
      return json({ error: 'Wrong password.' }, 401);
    }
    return json({ ok: true }, 200,
      { 'Set-Cookie': cookieHeader(await makeSession(env), 60 * 60 * 24 * 30) });
  }

  if (path === '/api/logout' && method === 'POST')
    return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', 0) });

  if (path === '/api/roms' && method === 'GET') {
    if (!await validSession(request, env)) return json({ error: 'locked' }, 401);
    if (!env.ROMS) return json({ error: 'No R2 binding named ROMS.' }, 500);
    const out = [];
    let cursor;
    do {
      const page = await env.ROMS.list({ limit: 1000, cursor });
      for (const o of page.objects)
        if (ROM.test(o.key)) out.push({ key: o.key, size: o.size, etag: o.etag });
      cursor = page.truncated ? page.cursor : null;
    } while (cursor);
    out.sort((a, b) => a.key.localeCompare(b.key));
    return json({ roms: out });
  }

  if (path.startsWith('/api/roms/') && method === 'GET') {
    if (!await validSession(request, env))
      return new Response('locked', { status: 401 });
    if (!env.ROMS) return new Response('No R2 binding named ROMS.', { status: 500 });
    return serveRom(request, env, decodeURIComponent(path.slice('/api/roms/'.length)));
  }

  return json({ error: 'not found' }, 404);
}

/* Range requests are honoured so a dropped download resumes rather than
   restarting — these files are big enough on a phone connection to matter. */
async function serveRom(request, env, key) {
  if (!key) return new Response('missing key', { status: 400 });

  const range = request.headers.get('Range');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  const opts = {};
  if (m && m[1] !== '') {
    const offset = Number(m[1]);
    opts.range = m[2] === '' ? { offset }
                             : { offset, length: Number(m[2]) - offset + 1 };
  }

  const obj = await env.ROMS.get(key, opts);
  if (!obj) return new Response('not found', { status: 404 });

  const h = new Headers();
  h.set('Content-Type', 'application/octet-stream');
  h.set('Cache-Control', 'private, max-age=31536000, immutable');
  h.set('Accept-Ranges', 'bytes');
  if (obj.httpEtag) h.set('ETag', obj.httpEtag);

  if (opts.range && obj.range) {
    const start = obj.range.offset || 0;
    const end = start + (obj.range.length || (obj.size - start)) - 1;
    h.set('Content-Range', `bytes ${start}-${end}/${obj.size}`);
    h.set('Content-Length', String(end - start + 1));
    return new Response(obj.body, { status: 206, headers: h });
  }

  h.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers: h });
}
