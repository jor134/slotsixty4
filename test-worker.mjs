/* Exercises the Worker's routing and auth against fakes for ASSETS and R2.
   Confirms the bucket is unreachable without a valid session. */
const mod = await import('./src/index.js');
const worker = mod.default;

const env = {
  FAMILY_PASSWORD: 'family-pass',
  SESSION_SECRET: 'a-long-random-session-secret',
  ASSETS: { fetch: async () => new Response('STATIC', { status: 200 }) },
  ROMS: {
    async list() {
      return { truncated: false, objects: [
        { key: 'mario64.z64', size: 8388608, etag: 'a' },
        { key: 'zelda-oot.z64', size: 33554432, etag: 'b' },
        { key: 'cover-art.png', size: 1024, etag: 'c' }
      ] };
    },
    async get(key) {
      if (key !== 'mario64.z64') return null;
      return { body: 'ROMBYTES', size: 8388608, httpEtag: '"a"' };
    }
  }
};

const req = (path, opts = {}) => new Request('https://slot64.test' + path, opts);
let fail = 0, n = 0;
const check = (cond, label) => { n++; if (!cond) { fail++; console.log('  FAIL ' + label); } };

// static passthrough
check((await worker.fetch(req('/'), env)).status === 200, 'static served');
check(await (await worker.fetch(req('/index.html'), env)).text() === 'STATIC', 'assets binding used');

// locked by default
check((await worker.fetch(req('/api/roms'), env)).status === 401, 'rom list locked');
check((await worker.fetch(req('/api/roms/mario64.z64'), env)).status === 401, 'rom body locked');
check((await (await worker.fetch(req('/api/session'), env)).json()).auth === false, 'session false');

// wrong password
const bad = await worker.fetch(req('/api/login', {
  method: 'POST', body: JSON.stringify({ password: 'nope' }) }), env);
check(bad.status === 401, 'wrong password rejected');
check(!bad.headers.get('Set-Cookie'), 'no cookie on failure');

// correct password
const good = await worker.fetch(req('/api/login', {
  method: 'POST', body: JSON.stringify({ password: 'family-pass' }) }), env);
check(good.status === 200, 'login ok');
const setC = good.headers.get('Set-Cookie') || '';
check(/HttpOnly/.test(setC) && /Secure/.test(setC) && /SameSite=Lax/.test(setC),
  'cookie flags: ' + setC);
const cookie = setC.split(';')[0];

// authed access
const listed = await worker.fetch(req('/api/roms', { headers: { Cookie: cookie } }), env);
check(listed.status === 200, 'list authed');
const roms = (await listed.json()).roms;
check(roms.length === 2, 'non-ROM files filtered, got ' + roms.length);
check(roms[0].key === 'mario64.z64', 'sorted');

const body = await worker.fetch(req('/api/roms/mario64.z64', { headers: { Cookie: cookie } }), env);
check(body.status === 200, 'rom served');
check(body.headers.get('Content-Length') === '8388608', 'content-length set');
check(body.headers.get('Accept-Ranges') === 'bytes', 'ranges advertised');

const missing = await worker.fetch(req('/api/roms/nope.z64', { headers: { Cookie: cookie } }), env);
check(missing.status === 404, 'missing rom 404s');

// forged cookie
const forged = 'ROMS=x; s64=' + encodeURIComponent('99999999999.deadbeef');
check((await worker.fetch(req('/api/roms', { headers: { Cookie: forged } }), env)).status === 401,
  'forged cookie rejected');

// missing secrets
const noSecret = await worker.fetch(req('/api/login', {
  method: 'POST', body: JSON.stringify({ password: 'x' }) }), { ...env, SESSION_SECRET: '' });
check(noSecret.status === 500, 'missing secret reported');

console.log(`\n${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
