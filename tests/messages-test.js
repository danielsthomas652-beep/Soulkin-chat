'use strict';
/* mLT. chat — private messaging (DMs) end-to-end test suite.
 *
 * Real HTTP + real WebSocket clients against a real running server, in the
 * style of tests/friends-test.js and tests/crossband-test.js. The app is
 * copied to a throwaway temp dir (with node_modules symlinked) so the
 * shipped data/solkin.db is never touched.
 *
 * Usage:
 *   node tests/messages-test.js                # local engine (better-sqlite3 / node:sqlite)
 *   node tests/messages-test.js --engine=libsql # Turso facade via @libsql/client on a file: DB
 *
 * The rules under test:
 *   * Messages only between ACCEPTED friends (non-friends -> 403).
 *   * Cross-band (adult <-> Protected) friends confirmed under the
 *     knows-in-real-life rule (known_confirmed = 1) MAY message; a
 *     cross-band row without the confirmation (forced into the DB) may not.
 *   * Cross-band video calls stay refused even for confirmed friends.
 *   * Profanity filtered like posts; ~1000-char cap; empty refused.
 *   * Threads persist across a restart; opening a thread marks read;
 *     unread counts and the live WS dm push behave.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=local').split('=')[1];
const APP_SRC = path.join(__dirname, '..');
const PORT = 3700 + Math.floor(Math.random() * 250);
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
async function befriend(from, to, extra) {
  const r = await from.client.post('/api/friends/request', { userId: to.user.id, ...(extra || {}) });
  if (r.status !== 200) throw new Error('friend request failed: ' + JSON.stringify(r));
  const a = await to.client.post('/api/friends/accept', { requestId: r.data.requestId, ...(extra && extra.acceptExtra ? extra.acceptExtra : {}) });
  if (a.status !== 200) throw new Error('friend accept failed: ' + JSON.stringify(a));
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-messages-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: `file:${path.join(tmpRoot, 'cloud.db')}`, TURSO_AUTH_TOKEN: 'test-token', SESSION_SECRET: 'test-secret' }
    : {};
  const dbFile = ENGINE === 'libsql' ? path.join(tmpRoot, 'cloud.db') : path.join(appDir, 'data', 'solkin.db');
  console.log(`Messages test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  const sockets = [];
  let child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    // --- served UI ships the Chat tab + thread ---
    const html = await (await fetch(BASE + '/')).text();
    check('served HTML has the Chat view, thread view and nav badge', html.includes('id="view-chat"') && html.includes('id="threadView"') && html.includes('id="chatBadge"') && html.includes('data-nav="chat"'));
    const js = await (await fetch(BASE + '/app.js')).text();
    check('served JS handles live dm pushes and opens threads', js.includes('onIncomingDm') && js.includes("m.type === 'dm'") && js.includes('loadConversations'));

    const A = await signup('Adult A', { username: `ma_${RUN}` });
    const B = await signup('Adult B', { username: `mb_${RUN}` });
    const C = await signup('Stranger C', { username: `mc_${RUN}` });
    const P = await signup('Protected P', { username: `mp_${RUN}`, under18: true });
    const D = await signup('Adult D', { username: `md_${RUN}` });
    check('signups succeed (4 adults, 1 protected)', [A, B, C, P, D].every((x) => x.status === 200 && x.user));

    // --- auth required ---
    const anon = new Client();
    let r = await anon.post(`/api/messages/${B.user.id}`, { text: 'hi' });
    check('logged-out send refused (401)', r.status === 401, `got ${r.status}`);
    r = await anon.get('/api/conversations');
    check('logged-out conversations refused (401)', r.status === 401, `got ${r.status}`);
    r = await anon.get(`/api/messages/${B.user.id}`);
    check('logged-out thread refused (401)', r.status === 401, `got ${r.status}`);

    // --- non-friends cannot message ---
    r = await A.client.post(`/api/messages/${C.user.id}`, { text: 'hello stranger' });
    check('non-friend send refused (403, plain language)', r.status === 403 && /only message your friends/i.test(r.data.error || ''), `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await C.client.post(`/api/messages/${A.user.id}`, { text: 'hello back' });
    check('non-friend send refused the other way (403)', r.status === 403, `got ${r.status}`);
    r = await A.client.get(`/api/messages/${C.user.id}`);
    check('non-friend thread refused (403)', r.status === 403, `got ${r.status}`);
    r = await A.client.post('/api/messages/999999', { text: 'anyone there?' });
    check('message to a nonexistent user refused (404)', r.status === 404, `got ${r.status}`);

    // --- become friends: A-B same band; P-D cross-band confirmed ---
    await befriend(A, B);
    await befriend(P, D, { knowsPerson: true });
    check('A-B friends; P-D cross-band confirmed friends', true);

    r = await B.client.get(`/api/messages/${A.user.id}`);
    check('empty thread loads (200, no messages)', r.status === 200 && Array.isArray(r.data.messages) && r.data.messages.length === 0, `got ${r.status} ${JSON.stringify(r.data)}`);

    // --- basic send/receive + order ---
    r = await A.client.post(`/api/messages/${B.user.id}`, { text: 'm1 hello B' });
    check('friend send succeeds (200, mine=true)', r.status === 200 && r.data.message && r.data.message.text === 'm1 hello B' && r.data.message.mine === true, `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await B.client.get(`/api/messages/${A.user.id}`);
    check('B thread shows m1 (mine=false)', r.status === 200 && r.data.messages.length === 1 && r.data.messages[0].text === 'm1 hello B' && r.data.messages[0].mine === false, JSON.stringify(r.data.messages));
    r = await B.client.post(`/api/messages/${A.user.id}`, { text: 'm2 hi A' });
    check('reply send succeeds (200)', r.status === 200, `got ${r.status}`);
    r = await A.client.get(`/api/messages/${B.user.id}`);
    check('A thread has both messages, oldest → newest', r.status === 200 && r.data.messages.length === 2 && r.data.messages[0].text === 'm1 hello B' && r.data.messages[1].text === 'm2 hi A', JSON.stringify(r.data.messages));

    // --- validation: empty + self ---
    r = await A.client.post(`/api/messages/${B.user.id}`, { text: '' });
    check('empty message refused (400)', r.status === 400, `got ${r.status}`);
    r = await A.client.post(`/api/messages/${B.user.id}`, { text: '   ' });
    check('whitespace-only message refused (400)', r.status === 400, `got ${r.status}`);
    r = await A.client.post(`/api/messages/${A.user.id}`, { text: 'note to self' });
    check('message to self refused (400)', r.status === 400, `got ${r.status}`);

    // --- profanity filter + length cap ---
    r = await A.client.post(`/api/messages/${B.user.id}`, { text: 'that is damn rude' });
    check('profanity filtered like posts', r.status === 200 && !/damn/i.test(r.data.message.text) && r.data.message.text.includes('****'), `got ${JSON.stringify(r.data.message)}`);
    r = await A.client.post(`/api/messages/${B.user.id}`, { text: 'x'.repeat(1500) });
    check('long message capped at 1000 chars', r.status === 200 && r.data.message.text.length === 1000, `got length ${r.data.message && r.data.message.text.length}`);

    // --- unread counts + conversations shape ---
    r = await B.client.get('/api/conversations');
    const bConvo = r.data.conversations.find((c) => c.user.id === A.user.id);
    check('B conversations: unread from A = 2, totalUnread = 2', !!bConvo && bConvo.unread === 2 && r.data.totalUnread === 2, JSON.stringify(r.data));
    check('B conversations: lastMessage is the latest, mine=false', !!bConvo && !!bConvo.lastMessage && bConvo.lastMessage.text.length === 1000 && bConvo.lastMessage.mine === false, JSON.stringify(bConvo && bConvo.lastMessage));
    r = await A.client.get('/api/conversations');
    const aConvo = r.data.conversations.find((c) => c.user.id === B.user.id);
    check('A conversations: unread from B = 0 (already read), lastMessage mine=true', !!aConvo && aConvo.unread === 0 && r.data.totalUnread === 0 && !!aConvo.lastMessage && aConvo.lastMessage.mine === true, JSON.stringify(r.data));
    r = await B.client.get(`/api/messages/${A.user.id}`);
    check('B thread now has all 4 messages in order', r.status === 200 && r.data.messages.length === 4 && r.data.messages[0].text === 'm1 hello B' && r.data.messages[1].text === 'm2 hi A' && r.data.messages[3].text.length === 1000, JSON.stringify(r.data.messages && r.data.messages.map((m) => m.text.slice(0, 12))));
    r = await B.client.get('/api/conversations');
    check('opening the thread marked everything read (unread back to 0)', r.data.totalUnread === 0 && r.data.conversations.find((c) => c.user.id === A.user.id).unread === 0, JSON.stringify(r.data));

    // --- live WS push ---
    const wsB = new WsClient(B.client.cookieHeader()); sockets.push(wsB);
    await wsB.opened;
    await wsB.waitFor((m) => m.type === 'presence', 'B presence');
    r = await A.client.post(`/api/messages/${B.user.id}`, { text: 'live hello' });
    check('send while B is online succeeds', r.status === 200, `got ${r.status}`);
    const dm = await wsB.waitFor((m) => m.type === 'dm' && m.message && m.message.text === 'live hello', 'dm push to B');
    check('online recipient gets the dm push (text + sender)', !!dm && dm.message.senderId === A.user.id && dm.message.mine === false && !!dm.message.from && dm.message.from.username === A.user.username, JSON.stringify(dm));
    const dmUnread = await wsB.waitFor((m) => m.type === 'dm-unread', 'dm-unread push to B');
    check('online recipient gets dm-unread with count 1', !!dmUnread && dmUnread.count === 1, JSON.stringify(dmUnread));
    wsB.close();
    r = await B.client.get(`/api/messages/${A.user.id}`); // marks 'live hello' read
    check('thread after live message has 5 messages', r.status === 200 && r.data.messages.length === 5, `got ${r.data.messages && r.data.messages.length}`);

    // --- cross-band confirmed friends CAN message ---
    r = await D.client.get('/api/conversations');
    const dConvo = r.data.conversations.find((c) => c.user.id === P.user.id);
    check('D conversations include P (no messages yet, lastMessage null)', !!dConvo && dConvo.lastMessage === null && dConvo.unread === 0, JSON.stringify(dConvo));
    r = await P.client.post(`/api/messages/${D.user.id}`, { text: 'hi from P' });
    check('Protected → adult confirmed friend message succeeds (200)', r.status === 200 && r.data.message.text === 'hi from P', `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await D.client.post(`/api/messages/${P.user.id}`, { text: 'hi from D' });
    check('adult → Protected confirmed friend message succeeds (200)', r.status === 200, `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await P.client.get('/api/conversations');
    check('P conversations: unread from D = 1 before opening', r.data.conversations.find((c) => c.user.id === D.user.id).unread === 1 && r.data.totalUnread === 1, JSON.stringify(r.data));
    r = await D.client.get(`/api/messages/${P.user.id}`);
    check('D thread with P has both messages in order', r.status === 200 && r.data.messages.length === 2 && r.data.messages[0].text === 'hi from P' && r.data.messages[1].text === 'hi from D', JSON.stringify(r.data.messages));
    r = await P.client.get(`/api/messages/${D.user.id}`); // marks D's message read
    check('P opening thread marks read', r.status === 200 && r.data.messages.length === 2);

    // --- defense in depth: cross-band row WITHOUT confirmation (forced) ---
    const E = await signup('Adult E', { username: `me_${RUN}` });
    const Q = await signup('Protected Q', { username: `mq_${RUN}`, under18: true });
    const Database = require(path.join(APP_SRC, 'node_modules', 'better-sqlite3'));
    const raw = new Database(dbFile);
    try { raw.prepare("INSERT INTO friendships (requester_id, addressee_id, status, known_confirmed) VALUES (?, ?, 'accepted', 0)").run(E.user.id, Q.user.id); }
    finally { raw.close(); }
    r = await E.client.get('/api/friends');
    check('forced unconfirmed cross-band row is live (E lists Q as friend)', r.data.friends.some((f) => f.id === Q.user.id), JSON.stringify(r.data.friends));
    r = await E.client.post(`/api/messages/${Q.user.id}`, { text: 'should not work' });
    check('unconfirmed cross-band messaging refused, adult side (403)', r.status === 403, `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await Q.client.post(`/api/messages/${E.user.id}`, { text: 'should not work either' });
    check('unconfirmed cross-band messaging refused, Protected side (403)', r.status === 403, `got ${r.status}`);
    r = await Q.client.get(`/api/messages/${E.user.id}`);
    check('unconfirmed cross-band thread refused (403)', r.status === 403, `got ${r.status}`);

    // --- regression: cross-band confirmed friends still cannot video call ---
    const wsD = new WsClient(D.client.cookieHeader()); sockets.push(wsD);
    const wsP = new WsClient(P.client.cookieHeader()); sockets.push(wsP);
    await Promise.all([wsD.opened, wsP.opened]);
    await wsD.waitFor((m) => m.type === 'presence', 'D presence');
    await wsP.waitFor((m) => m.type === 'presence', 'P presence');
    const pMark = wsP.messages.length;
    wsD.send({ type: 'call', to: P.user.id });
    const callErr = await wsD.waitFor((m) => m.type === 'call-error' && /safety/i.test(m.error || ''), 'cross-band call refusal');
    check('cross-band confirmed friends: video call still refused (safety)', !!callErr, JSON.stringify(callErr));
    await sleep(400);
    check('P received no incoming-call', !wsP.since(pMark).some((m) => m.type === 'incoming-call'));
    wsD.close(); wsP.close();

    // --- restart persistence ---
    console.log('Restarting server…');
    await stopServer(child);
    child = startServer(appDir, env);
    await waitReady(child);
    const Bb = new Client();
    const lr = await Bb.post('/api/login', { username: `mb_${RUN}`, password: 'test-pass-1' });
    check('login after restart works', lr.status === 200, `got ${lr.status}`);
    r = await Bb.get(`/api/messages/${A.user.id}`);
    check('messages survived restart (5, in order)', r.status === 200 && r.data.messages.length === 5 && r.data.messages[0].text === 'm1 hello B' && r.data.messages[4].text === 'live hello', JSON.stringify(r.data.messages && r.data.messages.map((m) => m.text.slice(0, 12))));
    const Pb = new Client();
    await Pb.post('/api/login', { username: `mp_${RUN}`, password: 'test-pass-1' });
    r = await Pb.get(`/api/messages/${D.user.id}`);
    check('cross-band messages survived restart too', r.status === 200 && r.data.messages.length === 2, `got ${r.data.messages && r.data.messages.length}`);
  } finally {
    for (const s of sockets) s.close();
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
