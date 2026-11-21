'use strict';
/* mLT. chat — cross-band friend rule end-to-end test suite.
 *
 * Real HTTP + real WebSocket clients against a real running server, in the
 * style of tests/friends-test.js and tests/video-test.js. The app is copied
 * to a throwaway temp dir (with node_modules symlinked) so the shipped
 * data/solkin.db is never touched.
 *
 * Usage:
 *   node tests/crossband-test.js                # local engine (better-sqlite3 / node:sqlite)
 *   node tests/crossband-test.js --engine=libsql # Turso facade via @libsql/client on a file: DB
 *
 * The owner's rule: people who know each other in real life can be friends
 * across the adult / Protected (under-18) line; strangers cannot. The
 * Protected user always holds the key. Covers:
 *   1. Protected -> adult WITHOUT knowsPerson -> 400, no row created.
 *   2. Protected -> adult WITH knowsPerson -> pending (attestation stored);
 *      the adult accepts normally (no attestation from the adult).
 *   3. Adult -> Protected -> pending, flagged cross-band; the Protected
 *      addressee accepting WITHOUT knowsPerson -> 400; WITH it -> friends.
 *   4. Adult -> Protected declined by the Protected user, as before.
 *   5. /api/friends and /api/people expose crossBand / knownConfirmed /
 *      attestBy for pending items.
 *   6. Cross-band friends still CANNOT video call (signaling refused both
 *      directions, no incoming-call delivered).
 *   7. Same-band requests need no attestation (light check; the full
 *      same-band regression is tests/friends-test.js).
 *   8. A cross-band friendship (and its attestation) survives a restart.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=local').split('=')[1];
const APP_SRC = path.join(__dirname, '..');
const PORT = 3600 + Math.floor(Math.random() * 400);
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
    const cookie = this.cookieHeader();
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
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b || {}); }
}

class WsClient {
  constructor(cookieHeader) {
    this.messages = [];
    this.waiters = [];
    const headers = cookieHeader ? { Cookie: cookieHeader } : {};
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers });
    this.ws.on('message', (d) => {
      let m;
      try { m = JSON.parse(String(d)); } catch (e) { return; }
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => !w(m));
    });
    this.opened = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  waitFor(pred, desc, timeoutMs = 5000) {
    const found = this.messages.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout waiting for ' + desc + '; got: ' + JSON.stringify(this.messages.map((m) => m.type)))), timeoutMs);
      this.waiters.push((m) => { if (pred(m)) { clearTimeout(t); res(m); return true; } return false; });
    });
  }
  since(idx) { return this.messages.slice(idx); }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-crossband-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: `file:${path.join(tmpRoot, 'cloud.db')}`, TURSO_AUTH_TOKEN: 'test-token', SESSION_SECRET: 'test-secret' }
    : {};
  console.log(`Cross-band test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  const sockets = [];
  let child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    const A1 = await signup('Adult One', { username: `xa1_${RUN}` });
    const A2 = await signup('Adult Two', { username: `xa2_${RUN}` });
    const P1 = await signup('Protected One', { username: `xp1_${RUN}`, under18: true });
    const P2 = await signup('Protected Two', { username: `xp2_${RUN}`, under18: true });
    check('signups succeed (2 adults, 2 protected)', [A1, A2, P1, P2].every((x) => x.status === 200 && x.user));

    // --- 1. Protected -> adult without attestation: refused, no row ---
    let r = await P1.client.post('/api/friends/request', { userId: A1.user.id });
    check('protected → adult with no knowsPerson refused (400, plain language)', r.status === 400 && /real life/i.test(r.data.error || ''), `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await P1.client.post('/api/friends/request', { userId: A1.user.id, knowsPerson: false });
    check('protected → adult with knowsPerson:false refused (400)', r.status === 400, `got ${r.status}`);
    r = await A1.client.get('/api/friends');
    check('no row was created (adult incoming empty)', r.data.incoming.length === 0, JSON.stringify(r.data));
    r = await P1.client.get('/api/people');
    const p1SeesA1None = r.data.people.find((p) => p.id === A1.user.id);
    check('people: relationship still none after refusal', p1SeesA1None && p1SeesA1None.relationship === 'none' && p1SeesA1None.crossBand === true, JSON.stringify(p1SeesA1None));

    // --- 2. Protected -> adult with attestation; adult accepts normally ---
    r = await P1.client.post('/api/friends/request', { userId: A1.user.id, knowsPerson: true });
    check('protected → adult with knowsPerson succeeds (200, crossBand)', r.status === 200 && r.data.crossBand === true, `got ${r.status} ${JSON.stringify(r.data)}`);
    const reqP1A1 = r.data.requestId;
    r = await A1.client.get('/api/friends');
    const a1In = r.data.incoming.find((u) => u.id === P1.user.id);
    check('adult incoming shows crossBand + knownConfirmed, attestBy null', !!a1In && a1In.crossBand === true && a1In.knownConfirmed === true && a1In.attestBy === null, JSON.stringify(a1In));
    r = await P1.client.get('/api/friends');
    const p1Out = r.data.outgoing.find((u) => u.id === A1.user.id);
    check('protected outgoing shows crossBand + knownConfirmed', !!p1Out && p1Out.crossBand === true && p1Out.knownConfirmed === true, JSON.stringify(p1Out));
    r = await A1.client.get('/api/people');
    const a1SeesP1 = r.data.people.find((p) => p.id === P1.user.id);
    check('people: adult sees protected as pending_in, crossBand, confirmed', !!a1SeesP1 && a1SeesP1.relationship === 'pending_in' && a1SeesP1.crossBand === true && a1SeesP1.knownConfirmed === true, JSON.stringify(a1SeesP1));
    r = await A1.client.post('/api/friends/accept', { requestId: reqP1A1 });
    check('adult accepts WITHOUT attestation → 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await A1.client.get('/api/friends');
    const a1FriendP1 = r.data.friends.find((u) => u.id === P1.user.id);
    check('A1 lists P1 as friend (crossBand flagged)', !!a1FriendP1 && a1FriendP1.crossBand === true, JSON.stringify(a1FriendP1));
    r = await P1.client.get('/api/friends');
    check('P1 lists A1 as friend', r.data.friends.some((u) => u.id === A1.user.id));

    // --- 3. Adult -> Protected: pending; Protected must attest to accept ---
    r = await A2.client.post('/api/friends/request', { userId: P2.user.id });
    check('adult → protected request created (200, crossBand — not 403)', r.status === 200 && r.data.crossBand === true, `got ${r.status} ${JSON.stringify(r.data)}`);
    const reqA2P2 = r.data.requestId;
    r = await P2.client.get('/api/friends');
    const p2In = r.data.incoming.find((u) => u.id === A2.user.id);
    check('protected incoming shows crossBand, not confirmed, attestBy "me"', !!p2In && p2In.crossBand === true && p2In.knownConfirmed === false && p2In.attestBy === 'me', JSON.stringify(p2In));
    r = await A2.client.get('/api/friends');
    const a2Out = r.data.outgoing.find((u) => u.id === P2.user.id);
    check('adult outgoing shows crossBand, attestBy "them"', !!a2Out && a2Out.crossBand === true && a2Out.knownConfirmed === false && a2Out.attestBy === 'them', JSON.stringify(a2Out));
    r = await P2.client.get('/api/people');
    const p2SeesA2 = r.data.people.find((p) => p.id === A2.user.id);
    check('people: protected sees adult pending_in, attestBy "me"', !!p2SeesA2 && p2SeesA2.relationship === 'pending_in' && p2SeesA2.crossBand === true && p2SeesA2.attestBy === 'me', JSON.stringify(p2SeesA2));
    r = await A2.client.get('/api/people');
    const a2SeesP2 = r.data.people.find((p) => p.id === P2.user.id);
    check('people: adult sees protected pending_out, attestBy "them"', !!a2SeesP2 && a2SeesP2.relationship === 'pending_out' && a2SeesP2.crossBand === true && a2SeesP2.attestBy === 'them', JSON.stringify(a2SeesP2));
    r = await P2.client.post('/api/friends/accept', { requestId: reqA2P2 });
    check('protected accepting without knowsPerson refused (400)', r.status === 400 && /real life/i.test(r.data.error || ''), `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await P2.client.post('/api/friends/accept', { requestId: reqA2P2, knowsPerson: false });
    check('protected accepting with knowsPerson:false refused (400)', r.status === 400, `got ${r.status}`);
    r = await P2.client.get('/api/friends');
    check('request still pending after refused accepts', r.data.incoming.some((u) => u.id === A2.user.id) && r.data.friends.length === 0, JSON.stringify(r.data));
    r = await P2.client.post('/api/friends/accept', { requestId: reqA2P2, knowsPerson: true });
    check('protected accepting WITH knowsPerson → 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await A2.client.get('/api/friends');
    const a2FriendP2 = r.data.friends.find((u) => u.id === P2.user.id);
    check('A2 lists P2 as friend, attestation now confirmed', !!a2FriendP2 && a2FriendP2.crossBand === true && a2FriendP2.knownConfirmed === true, JSON.stringify(a2FriendP2));
    r = await P2.client.get('/api/friends');
    check('P2 lists A2 as friend', r.data.friends.some((u) => u.id === A1.user.id) === false && r.data.friends.some((u) => u.id === A2.user.id));

    // --- 4. Adult -> Protected: decline works as before ---
    r = await A1.client.post('/api/friends/request', { userId: P2.user.id });
    check('A1 → P2 request created (200)', r.status === 200, `got ${r.status}`);
    const reqA1P2 = r.data.requestId;
    r = await P2.client.post('/api/friends/decline', { requestId: reqA1P2 });
    check('protected declines adult request → 200', r.status === 200, `got ${r.status}`);
    r = await A1.client.get('/api/friends');
    check('after decline, A1 outgoing no longer lists P2', !r.data.outgoing.some((u) => u.id === P2.user.id));
    r = await A1.client.post('/api/friends/request', { userId: P2.user.id });
    check('A1 can re-request P2 after decline (200)', r.status === 200, `got ${r.status}`);
    const reqA1P2b = r.data.requestId;
    r = await P2.client.post('/api/friends/decline', { requestId: reqA1P2b });
    check('cleanup decline → 200', r.status === 200, `got ${r.status}`);

    // --- 7. Same-band needs no attestation ---
    r = await A1.client.post('/api/friends/request', { userId: A2.user.id });
    check('adult → adult without knowsPerson succeeds, not cross-band', r.status === 200 && r.data.crossBand === false, `got ${r.status} ${JSON.stringify(r.data)}`);
    const reqA1A2 = r.data.requestId;
    r = await A2.client.post('/api/friends/accept', { requestId: reqA1A2 });
    check('adult accepts adult without attestation → 200', r.status === 200, `got ${r.status}`);
    r = await P1.client.post('/api/friends/request', { userId: P2.user.id });
    check('protected → protected without knowsPerson succeeds, not cross-band', r.status === 200 && r.data.crossBand === false, `got ${r.status} ${JSON.stringify(r.data)}`);
    const reqP1P2 = r.data.requestId;
    r = await P2.client.post('/api/friends/accept', { requestId: reqP1P2 });
    check('protected accepts protected without attestation → 200', r.status === 200, `got ${r.status}`);

    // --- 6. Cross-band friends still cannot video call ---
    const wsA1 = new WsClient(A1.client.cookieHeader()); sockets.push(wsA1);
    const wsP1 = new WsClient(P1.client.cookieHeader()); sockets.push(wsP1);
    await Promise.all([wsA1.opened, wsP1.opened]);
    await wsA1.waitFor((m) => m.type === 'presence', 'A1 presence');
    await wsP1.waitFor((m) => m.type === 'presence', 'P1 presence');
    check('cross-band friends are online to each other (presence flows)', true);

    let pMark = wsP1.messages.length;
    wsA1.send({ type: 'call', to: P1.user.id });
    const callErr1 = await wsA1.waitFor((m) => m.type === 'call-error' && /safety/i.test(m.error || ''), 'adult→protected call refusal');
    check('adult → Protected video call refused at setup (safety)', !!callErr1, JSON.stringify(callErr1));
    await sleep(400);
    check('P1 received no incoming-call', !wsP1.since(pMark).some((m) => m.type === 'incoming-call'));

    let aMark = wsA1.messages.length;
    wsP1.send({ type: 'call', to: A1.user.id });
    const callErr2 = await wsP1.waitFor((m) => m.type === 'call-error' && /safety/i.test(m.error || ''), 'protected→adult call refusal');
    check('Protected → adult video call refused at setup (safety)', !!callErr2, JSON.stringify(callErr2));
    await sleep(400);
    check('A1 received no incoming-call', !wsA1.since(aMark).some((m) => m.type === 'incoming-call'));
    wsA1.close(); wsP1.close();

    // --- 8. Restart persistence (friendship + attestation) ---
    console.log('Restarting server…');
    await stopServer(child);
    child = startServer(appDir, env);
    await waitReady(child);
    const A2b = new Client();
    const lr = await A2b.post('/api/login', { username: `xa2_${RUN}`, password: 'test-pass-1' });
    check('login after restart works', lr.status === 200, `got ${lr.status}`);
    r = await A2b.get('/api/friends');
    const p2After = r.data.friends.find((u) => u.id === P2.user.id);
    check('cross-band friendship + attestation survived restart', !!p2After && p2After.crossBand === true && p2After.knownConfirmed === true, JSON.stringify(p2After));
  } finally {
    for (const s of sockets) s.close();
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
