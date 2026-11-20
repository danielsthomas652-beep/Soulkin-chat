'use strict';
/* Solkin Chat — video chat signaling end-to-end test suite.
 *
 * Real HTTP + real WebSocket clients against a real running server, in the
 * style of tests/friends-test.js. The app is copied to a throwaway temp dir
 * (with node_modules symlinked) so the shipped data/solkin.db is never
 * touched. WebRTC media itself can't be exercised headlessly — what IS
 * tested here is the signaling relay and every server-side call rule:
 *
 *   (a) two friends exchange offer / answer / ICE through the relay;
 *   (b) a call to a NON-friend is refused by the server;
 *   (c) an adult -> Protected call is refused even with a friendship row
 *       forced straight into the database (defense in depth);
 *   (d) signaling is never relayed to third parties — including a friend
 *       who tries to inject ICE into someone else's call.
 *
 * Plus: session-cookie auth on the socket, presence (online friends list,
 * friend-online/offline, /api/friends online flags), offline-friend calls,
 * decline, hangup, and busy / already-in-a-call handling.
 *
 * Usage:
 *   node tests/video-test.js                  # local engine
 *   node tests/video-test.js --engine=libsql  # Turso facade on a file: DB
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=local').split('=')[1];
const APP_SRC = path.join(__dirname, '..');
const PORT = 3900 + Math.floor(Math.random() * 400);
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
async function befriend(a, b) {
  const r = await a.client.post('/api/friends/request', { userId: b.user.id });
  if (r.status !== 200) throw new Error('befriend request failed: ' + JSON.stringify(r));
  const acc = await b.client.post('/api/friends/accept', { requestId: r.data.requestId });
  if (acc.status !== 200) throw new Error('befriend accept failed: ' + JSON.stringify(acc));
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-video-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: `file:${path.join(tmpRoot, 'cloud.db')}`, TURSO_AUTH_TOKEN: 'test-token', SESSION_SECRET: 'test-secret' }
    : {};
  const dbFile = ENGINE === 'libsql' ? path.join(tmpRoot, 'cloud.db') : path.join(appDir, 'data', 'solkin.db');
  console.log(`Video chat test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  const sockets = [];
  let child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    // ----- people & friendships (over HTTP) -----
    const A = await signup('Adult A', { username: `va_${RUN}` });
    const B = await signup('Adult B', { username: `vb_${RUN}` });
    const C = await signup('Adult C', { username: `vc_${RUN}` });
    const D = await signup('Adult D', { username: `vd_${RUN}` });
    const E = await signup('Adult E', { username: `ve_${RUN}` });
    const P = await signup('Protected P', { username: `vp_${RUN}`, under18: true });
    check('signups succeed (5 adults, 1 protected)', [A, B, C, D, E, P].every((x) => x.status === 200 && x.user));
    await befriend(A, B);   // the main call pair
    await befriend(A, D);   // D = bystander friend (third-party checks)
    await befriend(A, E);   // E = friend who stays offline
    await befriend(B, C);   // C can try to call B while B is busy; A–C are NOT friends
    check('friendships set up (A–B, A–D, A–E, B–C)', true);

    // ----- socket auth -----
    const anon = new WsClient('');
    sockets.push(anon);
    const anonOutcome = await Promise.race([
      anon.opened.then(() => 'opened'),
      new Promise((r) => anon.ws.on('error', () => r('error'))),
      sleep(1500).then(() => 'timeout'),
    ]);
    await sleep(300);
    check('unauthenticated socket is refused (no open, no presence)', anonOutcome !== 'opened' && !anon.messages.some((m) => m.type === 'presence'), 'outcome: ' + anonOutcome);

    // ----- presence -----
    const wsA = new WsClient(A.client.cookieHeader()); sockets.push(wsA);
    await wsA.opened;
    const presA = await wsA.waitFor((m) => m.type === 'presence', 'A presence');
    check('A gets presence; nobody online yet', Array.isArray(presA.online) && presA.online.length === 0, JSON.stringify(presA));

    const wsB = new WsClient(B.client.cookieHeader()); sockets.push(wsB);
    await wsB.opened;
    const presB = await wsB.waitFor((m) => m.type === 'presence', 'B presence');
    check('B presence lists A as online', presB.online.includes(A.user.id), JSON.stringify(presB));
    await wsA.waitFor((m) => m.type === 'friend-online' && m.user && m.user.id === B.user.id, 'A sees B come online');
    check('A is told B came online', true);

    let r = await A.client.get('/api/friends');
    const bEntry = r.data.friends.find((f) => f.id === B.user.id);
    const eEntry = r.data.friends.find((f) => f.id === E.user.id);
    check('/api/friends marks B online, E offline', !!bEntry && bEntry.online === true && !!eEntry && eEntry.online === false, JSON.stringify(r.data.friends));

    // ----- offline friend -----
    wsA.send({ type: 'call', to: E.user.id });
    const offErr = await wsA.waitFor((m) => m.type === 'call-error' && /isn't online/.test(m.error || ''), 'offline call error');
    check('call to offline friend refused ("isn\'t online")', !!offErr, JSON.stringify(offErr));

    const wsC = new WsClient(C.client.cookieHeader()); sockets.push(wsC);
    const wsD = new WsClient(D.client.cookieHeader()); sockets.push(wsD);
    await Promise.all([wsC.opened, wsD.opened]);
    await wsD.waitFor((m) => m.type === 'presence', 'D presence');

    // ----- (b) non-friend call refused -----
    const cMark = wsC.messages.length;
    wsA.send({ type: 'call', to: C.user.id });
    const nfErr = await wsA.waitFor((m) => m.type === 'call-error' && /only video call your friends/.test(m.error || ''), 'non-friend call error');
    check('(b) A → C (not friends) refused by server', !!nfErr, JSON.stringify(nfErr));
    await sleep(400);
    check('(b) C received no incoming-call', !wsC.since(cMark).some((m) => m.type === 'incoming-call'));

    // ----- (a) full call A → B -----
    wsA.send({ type: 'call', to: B.user.id });
    const incoming = await wsB.waitFor((m) => m.type === 'incoming-call', 'B incoming call');
    check('(a) B gets incoming-call from A', incoming.from && incoming.from.id === A.user.id && !!incoming.callId, JSON.stringify(incoming));
    const callId = incoming.callId;
    const ringing = await wsA.waitFor((m) => m.type === 'ringing' && m.callId === callId, 'A ringing');
    check('(a) A gets ringing for the same call', !!ringing);

    const offerSdp = { type: 'offer', sdp: 'fake-offer-sdp-v1' };
    wsA.send({ type: 'offer', callId, sdp: offerSdp });
    const gotOffer = await wsB.waitFor((m) => m.type === 'offer' && m.callId === callId, 'B receives offer');
    check('(a) offer relayed A → B with SDP intact', gotOffer.sdp && gotOffer.sdp.sdp === 'fake-offer-sdp-v1', JSON.stringify(gotOffer));

    // (d) a third party tries to inject ICE into the call — must go nowhere
    const aMark = wsA.messages.length, bMark = wsB.messages.length;
    wsD.send({ type: 'ice', callId, candidate: { candidate: 'candidate:d-intruder', sdpMid: '0', sdpMLineIndex: 0 } });
    const dErr = await wsD.waitFor((m) => m.type === 'call-error', 'D intruder error');
    check('(d) non-participant signaling is rejected with an error', !!dErr, JSON.stringify(dErr));
    await sleep(400);
    check('(d) intruder ICE reached neither A nor B', ![...wsA.since(aMark), ...wsB.since(bMark)].some((m) => JSON.stringify(m).includes('d-intruder')));

    const answerSdp = { type: 'answer', sdp: 'fake-answer-sdp-v1' };
    wsB.send({ type: 'answer', callId, sdp: answerSdp });
    const gotAnswer = await wsA.waitFor((m) => m.type === 'answer' && m.callId === callId, 'A receives answer');
    check('(a) answer relayed B → A with SDP intact', gotAnswer.sdp && gotAnswer.sdp.sdp === 'fake-answer-sdp-v1', JSON.stringify(gotAnswer));

    const iceA = { candidate: 'candidate:a-ice-1', sdpMid: '0', sdpMLineIndex: 0 };
    wsA.send({ type: 'ice', callId, candidate: iceA });
    const gotIceB = await wsB.waitFor((m) => m.type === 'ice' && m.callId === callId && m.candidate && m.candidate.candidate === 'candidate:a-ice-1', 'B receives A ICE');
    check('(a) ICE relayed A → B intact', !!gotIceB);
    const iceB = { candidate: 'candidate:b-ice-1', sdpMid: '0', sdpMLineIndex: 0 };
    wsB.send({ type: 'ice', callId, candidate: iceB });
    const gotIceA = await wsA.waitFor((m) => m.type === 'ice' && m.callId === callId && m.candidate && m.candidate.candidate === 'candidate:b-ice-1', 'A receives B ICE');
    check('(a) ICE relayed B → A intact', !!gotIceA);

    check('(d) bystander D got no call signaling at all', !wsD.messages.some((m) => ['offer', 'answer', 'ice', 'incoming-call', 'ringing', 'declined', 'ended'].includes(m.type)),
      JSON.stringify(wsD.messages.map((m) => m.type)));

    // hangup ends it for the other side
    wsB.send({ type: 'hangup', callId });
    const ended = await wsA.waitFor((m) => m.type === 'ended' && m.callId === callId, 'A sees call ended');
    check('hangup by B notifies A (ended)', !!ended);

    // ----- decline -----
    wsA.send({ type: 'call', to: B.user.id });
    const incoming2 = await wsB.waitFor((m) => m.type === 'incoming-call' && m.callId !== callId, 'B second incoming call');
    wsB.send({ type: 'decline', callId: incoming2.callId });
    const declined = await wsA.waitFor((m) => m.type === 'declined' && m.callId === incoming2.callId, 'A sees decline');
    check('decline by B notifies A (declined)', !!declined);

    // ----- busy handling -----
    wsA.send({ type: 'call', to: B.user.id });
    const incoming3 = await wsB.waitFor((m) => m.type === 'incoming-call' && m.callId !== callId && m.callId !== incoming2.callId, 'B third incoming call');
    wsA.send({ type: 'call', to: D.user.id });
    const busySelf = await wsA.waitFor((m) => m.type === 'call-error' && /already in a call/.test(m.error || ''), 'A second call error');
    check('caller already in a call cannot start another', !!busySelf, JSON.stringify(busySelf));
    wsC.send({ type: 'call', to: B.user.id });
    const busyErr = await wsC.waitFor((m) => m.type === 'call-error' && /on another call/.test(m.error || ''), 'C busy error');
    check('call to a busy friend refused ("on another call")', !!busyErr, JSON.stringify(busyErr));
    wsA.send({ type: 'hangup', callId: incoming3.callId });
    await wsB.waitFor((m) => m.type === 'ended' && m.callId === incoming3.callId, 'B sees busy-test call end');
    check('busy-test call cleaned up by hangup', true);

    // ----- (c) adult <-> Protected, friendship forced into the DB -----
    const Database = require(path.join(APP_SRC, 'node_modules', 'better-sqlite3'));
    const raw = new Database(dbFile);
    try { raw.prepare("INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'accepted')").run(A.user.id, P.user.id); }
    finally { raw.close(); }
    r = await P.client.get('/api/friends');
    check('(c) forced friendship row is live (P lists A as friend)', r.data.friends.some((f) => f.id === A.user.id), JSON.stringify(r.data));

    const wsP = new WsClient(P.client.cookieHeader()); sockets.push(wsP);
    await wsP.opened;
    await wsP.waitFor((m) => m.type === 'presence', 'P presence');

    let pMark = wsP.messages.length;
    wsA.send({ type: 'call', to: P.user.id });
    const safeErr1 = await wsA.waitFor((m) => m.type === 'call-error' && /safety/i.test(m.error || ''), 'adult→protected refusal');
    check('(c) adult → Protected call refused at setup (safety)', !!safeErr1, JSON.stringify(safeErr1));
    await sleep(400);
    check('(c) P received no incoming-call from the adult', !wsP.since(pMark).some((m) => m.type === 'incoming-call'));

    const aMark2 = wsA.messages.length;
    wsP.send({ type: 'call', to: A.user.id });
    const safeErr2 = await wsP.waitFor((m) => m.type === 'call-error' && /safety/i.test(m.error || ''), 'protected→adult refusal');
    check('(c) Protected → adult call refused at setup (safety)', !!safeErr2, JSON.stringify(safeErr2));
    await sleep(400);
    check('(c) A received no incoming-call from the Protected account', !wsA.since(aMark2).some((m) => m.type === 'incoming-call'));
  } finally {
    for (const s of sockets) s.close();
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
