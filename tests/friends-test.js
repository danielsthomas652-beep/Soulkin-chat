'use strict';
/* Solkin Chat — friends system end-to-end test suite.
 *
 * Real HTTP against a real running server, in the style of the original
 * 30-check verification. The app is copied to a throwaway temp dir (with
 * node_modules symlinked) so the shipped data/solkin.db is never touched.
 *
 * Usage:
 *   node tests/friends-test.js                # local engine (better-sqlite3 / node:sqlite)
 *   node tests/friends-test.js --engine=libsql # Turso facade via @libsql/client on a file: DB
 *
 * Covers: request/accept/decline/remove, duplicate + reverse + self request
 * refusal, /api/people relationship states, the cross-band rule in brief
 * (Protected holds the key — the full matrix lives in
 * tests/crossband-test.js), and friendship persistence across a full
 * server restart.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=local').split('=')[1];
const APP_SRC = path.join(__dirname, '..');
const PORT = 3400 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Math.random().toString(36).slice(2, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

class Client {
  constructor() { this.cookies = new Map(); }
  async req(method, p, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const k = pair.slice(0, eq).trim(), v = pair.slice(eq + 1).trim();
        if (v) this.cookies.set(k, v); else this.cookies.delete(k);
      }
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { status: res.status, data };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b || {}); }
}

async function signup(name, opts) {
  const c = new Client();
  const r = await c.post('/api/signup', { displayName: name, username: opts.username, password: 'test-pass-1', under18: !!opts.under18 });
  return { client: c, status: r.status, user: r.data.user };
}

function startServer(appDir, env) {
  const child = spawn('node', ['server/index.js'], {
    cwd: appDir,
    env: { ...process.env, PORT: String(PORT), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.getOut = () => out;
  return child;
}
async function waitReady(child) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error('server exited early:\n' + child.getOut());
    try { const r = await fetch(BASE + '/api/people'); if (r.ok) return; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('server did not become ready:\n' + child.getOut());
}
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((r) => child.once('exit', r)), sleep(3000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-friends-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: `file:${path.join(tmpRoot, 'cloud.db')}`, TURSO_AUTH_TOKEN: 'test-token', SESSION_SECRET: 'test-secret' }
    : {};
  console.log(`Friends test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  let child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    const anon = new Client();
    check('GET /api/friends logged out → 401', (await anon.get('/api/friends')).status === 401);

    const A = await signup('Adult A', { username: `aa_${RUN}` });
    const B = await signup('Adult B', { username: `ab_${RUN}` });
    const C = await signup('Adult C', { username: `ac_${RUN}` });
    const P1 = await signup('Protected One', { username: `p1_${RUN}`, under18: true });
    const P2 = await signup('Protected Two', { username: `p2_${RUN}`, under18: true });
    check('signups succeed (3 adults, 2 protected)', [A, B, C, P1, P2].every((x) => x.status === 200 && x.user));
    check('protected signups flagged isProtected', P1.user.isProtected === true && P2.user.isProtected === true);
    check('adult signups not protected', A.user.isProtected === false);

    // --- basic request flow ---
    let r = await A.client.post('/api/friends/request', { userId: A.user.id });
    check('self-request refused (400)', r.status === 400, `got ${r.status}`);
    r = await A.client.post('/api/friends/request', { userId: B.user.id });
    check('A → B request succeeds', r.status === 200 && r.data.relationship === 'pending_out', `got ${r.status} ${JSON.stringify(r.data)}`);
    const reqAB = r.data.requestId;
    r = await A.client.post('/api/friends/request', { userId: B.user.id });
    check('duplicate request refused (409)', r.status === 409, `got ${r.status}`);
    r = await B.client.post('/api/friends/request', { userId: A.user.id });
    check('reverse request while pending refused (409)', r.status === 409, `got ${r.status}`);

    r = await B.client.get('/api/friends');
    check('B sees A in incoming', r.data.incoming.some((u) => u.id === A.user.id && u.requestId === reqAB), JSON.stringify(r.data));
    check('B has no friends yet', r.data.friends.length === 0);
    r = await A.client.get('/api/friends');
    check('A sees B in outgoing', r.data.outgoing.some((u) => u.id === B.user.id));

    r = await B.client.get('/api/people');
    const bSeesA = r.data.people.find((p) => p.id === A.user.id);
    check('people: B sees A as pending_in with request id', bSeesA && bSeesA.relationship === 'pending_in' && bSeesA.friendRequestId === reqAB, JSON.stringify(bSeesA));
    r = await A.client.get('/api/people');
    const aSeesB = r.data.people.find((p) => p.id === B.user.id);
    const aSeesSelf = r.data.people.find((p) => p.id === A.user.id);
    check('people: A sees B as pending_out', aSeesB && aSeesB.relationship === 'pending_out');
    check('people: A sees self as self', aSeesSelf && aSeesSelf.relationship === 'self');

    // --- accept flow ---
    r = await A.client.post('/api/friends/accept', { requestId: reqAB });
    check('requester cannot accept own request (403)', r.status === 403, `got ${r.status}`);
    r = await C.client.post('/api/friends/accept', { requestId: reqAB });
    check('third party cannot accept (403)', r.status === 403, `got ${r.status}`);
    r = await B.client.post('/api/friends/accept', { requestId: reqAB });
    check('B accepts → 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await A.client.get('/api/friends');
    check('A lists B as friend', r.data.friends.some((u) => u.id === B.user.id));
    r = await B.client.get('/api/friends');
    check('B lists A as friend', r.data.friends.some((u) => u.id === A.user.id));
    r = await A.client.post('/api/friends/request', { userId: B.user.id });
    check('request while already friends refused (409)', r.status === 409, `got ${r.status}`);
    r = await B.client.post('/api/friends/decline', { requestId: reqAB });
    check('decline of accepted friendship refused (409)', r.status === 409, `got ${r.status}`);

    // --- cross-band rule, in brief (full matrix: tests/crossband-test.js) ---
    // The Protected user holds the key: a Protected sender must attest
    // "knows in real life" before a request to an adult goes out, and a
    // Protected addressee must attest before accepting an adult's request.
    r = await P1.client.post('/api/friends/request', { userId: C.user.id });
    check('protected → adult without attestation refused (400)', r.status === 400, `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await C.client.post('/api/friends/request', { userId: P1.user.id });
    check('adult → protected request created pending, flagged cross-band (200)', r.status === 200 && r.data.crossBand === true, `got ${r.status} ${JSON.stringify(r.data)}`);
    const reqCP = r.data.requestId;
    r = await P1.client.post('/api/friends/accept', { requestId: reqCP });
    check('protected accepting adult request without attestation refused (400)', r.status === 400, `got ${r.status}`);
    r = await P1.client.post('/api/friends/decline', { requestId: reqCP });
    check('protected can still decline the adult request (200)', r.status === 200, `got ${r.status}`);
    r = await P1.client.get('/api/friends');
    check('no cross-band friendship resulted', r.data.friends.length === 0 && r.data.incoming.length === 0 && r.data.outgoing.length === 0, JSON.stringify(r.data));

    // --- protected <-> protected works ---
    r = await P1.client.post('/api/friends/request', { userId: P2.user.id });
    check('protected → protected request succeeds', r.status === 200, `got ${r.status} ${JSON.stringify(r.data)}`);
    const reqPP = r.data.requestId;
    r = await P2.client.get('/api/friends');
    check('P2 sees P1 incoming', r.data.incoming.some((u) => u.id === P1.user.id));
    r = await P2.client.post('/api/friends/accept', { requestId: reqPP });
    check('P2 accepts → 200', r.status === 200, `got ${r.status}`);
    r = await P1.client.get('/api/friends');
    check('P1 lists P2 as friend', r.data.friends.some((u) => u.id === P2.user.id));

    // --- decline flow ---
    r = await A.client.post('/api/friends/request', { userId: C.user.id });
    check('A → C request succeeds', r.status === 200, `got ${r.status}`);
    const reqAC = r.data.requestId;
    r = await A.client.post('/api/friends/decline', { requestId: reqAC });
    check('requester cannot decline own request (403)', r.status === 403, `got ${r.status}`);
    r = await C.client.post('/api/friends/decline', { requestId: reqAC });
    check('C declines → 200', r.status === 200, `got ${r.status}`);
    r = await A.client.get('/api/friends');
    check('after decline, A outgoing is empty', !r.data.outgoing.some((u) => u.id === C.user.id));
    r = await A.client.post('/api/friends/request', { userId: C.user.id });
    check('A can re-request C after decline', r.status === 200, `got ${r.status}`);

    // --- unfriend ---
    r = await B.client.post('/api/friends/remove', { userId: A.user.id });
    check('B unfriends A → 200', r.status === 200, `got ${r.status}`);
    r = await A.client.get('/api/friends');
    check('A no longer lists B', !r.data.friends.some((u) => u.id === B.user.id));
    r = await A.client.get('/api/people');
    const aSeesBAfter = r.data.people.find((p) => p.id === B.user.id);
    check('people: relationship back to none after unfriend', aSeesBAfter && aSeesBAfter.relationship === 'none');
    r = await B.client.post('/api/friends/remove', { userId: A.user.id });
    check('unfriend when not friends → 404', r.status === 404, `got ${r.status}`);

    // rebuild the A–B friendship so the restart check has something to find
    r = await A.client.post('/api/friends/request', { userId: B.user.id });
    const reqAB2 = r.data.requestId;
    r = await B.client.post('/api/friends/accept', { requestId: reqAB2 });
    check('A–B friendship rebuilt for restart check', r.status === 200, `got ${r.status}`);

    // --- restart persistence ---
    console.log('Restarting server…');
    await stopServer(child);
    child = startServer(appDir, env);
    await waitReady(child);
    const A2 = new Client();
    const lr = await A2.post('/api/login', { username: `aa_${RUN}`, password: 'test-pass-1' });
    check('login after restart works', lr.status === 200, `got ${lr.status}`);
    r = await A2.get('/api/friends');
    check('friendship A–B survived restart', r.data.friends.some((u) => u.id === B.user.id), JSON.stringify(r.data));
    const P1b = new Client();
    await P1b.post('/api/login', { username: `p1_${RUN}`, password: 'test-pass-1' });
    r = await P1b.get('/api/friends');
    check('friendship P1–P2 survived restart', r.data.friends.some((u) => u.id === P2.user.id), JSON.stringify(r.data));
  } finally {
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
