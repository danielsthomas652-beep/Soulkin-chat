'use strict';
/* mLT. chat — phone dialing end-to-end test suite.
 *
 * Real HTTP clients against a real running server, in the style of
 * tests/crossband-test.js and tests/message-photos-test.js. The app is
 * copied to a throwaway temp dir (node_modules symlinked) so the shipped
 * data/solkin.db is never touched. The temp database is PRE-CREATED with
 * the old users schema (no phone column) so every run also proves the
 * startup migration adds it.
 *
 * Usage:
 *   node tests/phone-dial-test.js                # local engine (better-sqlite3 / node:sqlite)
 *   node tests/phone-dial-test.js --engine=libsql # Turso facade via @libsql/client on a file: DB
 *
 * The rules under test (owner: friends should "be able to dial a number
 * to their friends to be able to call them"):
 *   * A user can add / edit / clear an optional phone number on their
 *     own profile (PATCH /api/me {phone}); punctuation is stripped, a
 *     leading + is kept, 7–15 digits required, anything else is a 400
 *     with a plain-language error. /api/me shows you your own number.
 *   * Accepted friends who shared a number expose it as `phone` on
 *     /api/friends, /api/people, /api/conversations and the message
 *     thread — the client turns it into a tel: Call link.
 *   * SAFETY: a Protected user's number is NEVER in any payload served
 *     to anyone else (friend, confirmed cross-band friend, stranger,
 *     anonymous). Non-friends and pending relationships see nothing.
 *     Cross-band pairs need friendships.known_confirmed = 1 before the
 *     ADULT's number is shown to the Protected friend — and the
 *     Protected user's number stays hidden even then.
 *   * Numbers survive a full server restart.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=local').split('=')[1];
const APP_SRC = path.join(__dirname, '..');
const PORT = 3800 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Math.random().toString(36).slice(2, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Distinct numbers per user, so a payload can be scanned for leaks.
const NUM = { A1: '5551110001', A2: '5552220002', P1: '5553330003', E: '5554440004', Q: '5555550005' };

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const leaks = (data, num) => JSON.stringify(data || {}).includes(num);

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
  patch(p, b) { return this.req('PATCH', p, b || {}); }
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-phone-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: `file:${path.join(tmpRoot, 'cloud.db')}`, TURSO_AUTH_TOKEN: 'test-token', SESSION_SECRET: 'test-secret' }
    : {};
  const dbFile = ENGINE === 'libsql' ? path.join(tmpRoot, 'cloud.db') : path.join(appDir, 'data', 'solkin.db');
  console.log(`Phone dial test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  // Pre-create the DB with the OLD users schema (no phone column): the
  // server's startup migration must add it, like on the production DB.
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const Database = require(path.join(APP_SRC, 'node_modules', 'better-sqlite3'));
  const pre = new Database(dbFile);
  pre.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    is_protected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  const preCols = pre.prepare("SELECT name FROM pragma_table_info('users')").all().map((c) => c.name);
  pre.close();
  check('pre-created DB really is the old schema (no phone column)', !preCols.includes('phone'), JSON.stringify(preCols));

  let child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    // --- served UI ships the dialing pieces ---
    const html = await (await fetch(BASE + '/')).text();
    check('served HTML has the profile phone field + Save and the thread Call link', html.includes('id="editPhone"') && html.includes('id="btnSavePhone"') && html.includes('id="threadCall"'));
    const js = await (await fetch(BASE + '/app.js')).text();
    check('served JS wires phone save and tel: Call links', js.includes('btnSavePhone') && js.includes('tel:') && js.includes('call-link'));

    const A1 = await signup('Adult One', { username: `da1_${RUN}` });
    const A2 = await signup('Adult Two', { username: `da2_${RUN}` });
    const P1 = await signup('Protected One', { username: `dp1_${RUN}`, under18: true });
    const P2 = await signup('Protected Two', { username: `dp2_${RUN}`, under18: true });
    const E = await signup('Adult E', { username: `de_${RUN}` });
    const Q = await signup('Protected Q', { username: `dq_${RUN}`, under18: true });
    check('signups succeed (on the migrated DB)', [A1, A2, P1, P2, E, Q].every((x) => x.status === 200 && x.user), JSON.stringify([A1, A2, P1, P2, E, Q].map((x) => x.status)));

    // --- validation: set / normalize / clear ---
    let r = await A1.client.patch('/api/me', { phone: 'abc' });
    check('letters as a phone number refused (400, plain language)', r.status === 400 && /number/i.test(r.data.error || ''), `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await A1.client.patch('/api/me', { phone: '12345' });
    check('too few digits refused (400)', r.status === 400, `got ${r.status}`);
    r = await A1.client.patch('/api/me', { phone: '5551234567890123456' });
    check('too many digits refused (400)', r.status === 400, `got ${r.status}`);
    r = await A1.client.patch('/api/me', {});
    check('PATCH with nothing to update refused (400)', r.status === 400, `got ${r.status}`);
    r = await A1.client.patch('/api/me', { phone: '(555) 123-4567' });
    check('punctuation is stripped on save', r.status === 200 && r.data.user.phone === '5551234567', `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await A1.client.get('/api/me');
    check('/api/me returns my own phone', r.status === 200 && r.data.user.phone === '5551234567', JSON.stringify(r.data.user));
    r = await A1.client.patch('/api/me', { phone: '+1 (555) 111-0001' });
    check('leading + country code is kept', r.status === 200 && r.data.user.phone === '+15551110001', `got ${r.status} ${JSON.stringify(r.data.user)}`);
    r = await A1.client.patch('/api/me', { displayName: 'Adult One' });
    check('name-only PATCH still works and leaves the phone alone', r.status === 200 && r.data.user.phone === '+15551110001', `got ${r.status} ${JSON.stringify(r.data.user)}`);
    r = await A1.client.patch('/api/me', { phone: '' });
    check('empty string clears the number', r.status === 200 && r.data.user.phone === null, `got ${r.status} ${JSON.stringify(r.data.user)}`);
    r = await A1.client.get('/api/me');
    check('/api/me shows the cleared number as null', r.data.user.phone === null, JSON.stringify(r.data.user));
    r = await A1.client.patch('/api/me', { phone: NUM.A1 });
    check('A1 sets the number used below', r.status === 200 && r.data.user.phone === NUM.A1, `got ${r.status}`);
    r = await A2.client.patch('/api/me', { phone: NUM.A2 });
    check('A2 sets their number', r.status === 200 && r.data.user.phone === NUM.A2, `got ${r.status}`);

    // --- non-friends see nothing ---
    r = await A2.client.get('/api/people');
    const a2SeesA1Stranger = r.data.people.find((p) => p.id === A1.user.id);
    check('stranger in People: phone null', !!a2SeesA1Stranger && a2SeesA1Stranger.phone === null && !leaks(r.data, NUM.A1), JSON.stringify(a2SeesA1Stranger));
    const anon = new Client();
    r = await anon.get('/api/people');
    check('anonymous People payload contains no numbers at all', !leaks(r.data, NUM.A1) && !leaks(r.data, NUM.A2), JSON.stringify(r.data).slice(0, 200));

    // --- pending relationships see nothing ---
    r = await A2.client.post('/api/friends/request', { userId: A1.user.id });
    check('A2 → A1 request sent', r.status === 200, `got ${r.status}`);
    const reqA2A1 = r.data.requestId;
    r = await A2.client.get('/api/people');
    const a2SeesA1Pending = r.data.people.find((p) => p.id === A1.user.id);
    check('pending_out in People: phone null', !!a2SeesA1Pending && a2SeesA1Pending.relationship === 'pending_out' && a2SeesA1Pending.phone === null && !leaks(r.data, NUM.A1), JSON.stringify(a2SeesA1Pending));
    r = await A1.client.get('/api/people');
    const a1SeesA2Pending = r.data.people.find((p) => p.id === A2.user.id);
    check('pending_in in People: phone null', !!a1SeesA2Pending && a1SeesA2Pending.relationship === 'pending_in' && a1SeesA2Pending.phone === null && !leaks(r.data, NUM.A2), JSON.stringify(a1SeesA2Pending));
    r = await A1.client.get('/api/friends');
    check('pending incoming in Friends: no number anywhere in the payload', !leaks(r.data, NUM.A2), JSON.stringify(r.data));

    // --- accepted friends see each other's numbers ---
    r = await A1.client.post('/api/friends/accept', { requestId: reqA2A1 });
    check('A1 accepts A2', r.status === 200, `got ${r.status}`);
    r = await A2.client.get('/api/friends');
    const a2FriendA1 = r.data.friends.find((u) => u.id === A1.user.id);
    check('friend sees my number in Friends', !!a2FriendA1 && a2FriendA1.phone === NUM.A1, JSON.stringify(a2FriendA1));
    r = await A1.client.get('/api/friends');
    const a1FriendA2 = r.data.friends.find((u) => u.id === A2.user.id);
    check('and I see theirs', !!a1FriendA2 && a1FriendA2.phone === NUM.A2, JSON.stringify(a1FriendA2));
    r = await A2.client.get('/api/people');
    const a2SeesA1Friend = r.data.people.find((p) => p.id === A1.user.id);
    check('friend in People carries the number', !!a2SeesA1Friend && a2SeesA1Friend.phone === NUM.A1, JSON.stringify(a2SeesA1Friend));
    r = await A2.client.get('/api/conversations');
    const a2ConvoA1 = r.data.conversations.find((c) => c.user.id === A1.user.id);
    check('conversation carries the number (thread Call link source)', !!a2ConvoA1 && a2ConvoA1.user.phone === NUM.A1, JSON.stringify(a2ConvoA1));
    r = await A2.client.get(`/api/messages/${A1.user.id}`);
    check('thread payload carries the number', r.status === 200 && r.data.user.phone === NUM.A1, `got ${r.status} ${JSON.stringify(r.data.user)}`);

    // --- a Protected user's number is NEVER exposed ---
    r = await P1.client.patch('/api/me', { phone: NUM.P1 });
    check('Protected user can store a number', r.status === 200 && r.data.user.phone === NUM.P1, `got ${r.status} ${JSON.stringify(r.data.user)}`);
    r = await P1.client.get('/api/me');
    check('…and sees it on their own /api/me', r.data.user.phone === NUM.P1, JSON.stringify(r.data.user));
    await befriend(P1, P2); // same-band friendship
    r = await P2.client.get('/api/friends');
    const p2FriendP1 = r.data.friends.find((u) => u.id === P1.user.id);
    check('Protected friend in Friends: phone null', !!p2FriendP1 && p2FriendP1.phone === null && !leaks(r.data, NUM.P1), JSON.stringify(p2FriendP1));
    r = await P2.client.get('/api/people');
    const p2SeesP1 = r.data.people.find((p) => p.id === P1.user.id);
    check('Protected friend in People: phone null, no leak', !!p2SeesP1 && p2SeesP1.phone === null && !leaks(r.data, NUM.P1), JSON.stringify(p2SeesP1));
    r = await P2.client.get('/api/conversations');
    check('Protected friend in conversations: no leak', !leaks(r.data, NUM.P1), JSON.stringify(r.data));
    r = await P2.client.get(`/api/messages/${P1.user.id}`);
    check('Protected friend thread: phone null, no leak', r.status === 200 && r.data.user.phone === null && !leaks(r.data, NUM.P1), `got ${r.status} ${JSON.stringify(r.data.user)}`);

    // --- cross-band CONFIRMED: adult's number shows, Protected's never ---
    await befriend(P1, A1, { knowsPerson: true }); // P1 attests; A1 accepts normally
    r = await A1.client.get('/api/friends');
    const a1FriendP1 = r.data.friends.find((u) => u.id === P1.user.id);
    check('confirmed adult friend: Protected number STILL null', !!a1FriendP1 && a1FriendP1.phone === null && !leaks(r.data, NUM.P1), JSON.stringify(a1FriendP1));
    r = await P1.client.get('/api/friends');
    const p1FriendA1 = r.data.friends.find((u) => u.id === A1.user.id);
    check('confirmed Protected friend sees the adult\'s number', !!p1FriendA1 && p1FriendA1.phone === NUM.A1, JSON.stringify(p1FriendA1));
    r = await P1.client.get(`/api/messages/${A1.user.id}`);
    check('confirmed cross-band thread: adult number present', r.status === 200 && r.data.user.phone === NUM.A1, `got ${r.status} ${JSON.stringify(r.data.user)}`);
    r = await A1.client.get(`/api/messages/${P1.user.id}`);
    check('adult\'s thread with Protected friend: phone null, no leak', r.status === 200 && r.data.user.phone === null && !leaks(r.data, NUM.P1), `got ${r.status} ${JSON.stringify(r.data.user)}`);
    r = await P1.client.get('/api/people');
    const p1SeesA1 = r.data.people.find((p) => p.id === A1.user.id);
    check('confirmed cross-band in People: adult number present', !!p1SeesA1 && p1SeesA1.phone === NUM.A1, JSON.stringify(p1SeesA1));

    // --- cross-band UNCONFIRMED (forced row): no number either way ---
    r = await E.client.patch('/api/me', { phone: NUM.E });
    check('E sets a number', r.status === 200 && r.data.user.phone === NUM.E, `got ${r.status}`);
    r = await Q.client.patch('/api/me', { phone: NUM.Q });
    check('Q sets a number', r.status === 200 && r.data.user.phone === NUM.Q, `got ${r.status}`);
    const raw = new Database(dbFile);
    try { raw.prepare("INSERT INTO friendships (requester_id, addressee_id, status, known_confirmed) VALUES (?, ?, 'accepted', 0)").run(E.user.id, Q.user.id); }
    finally { raw.close(); }
    r = await E.client.get('/api/friends');
    const eFriendQ = r.data.friends.find((u) => u.id === Q.user.id);
    check('unconfirmed: adult\'s Friends entry for Protected has no number', !!eFriendQ && eFriendQ.phone === null && !leaks(r.data, NUM.Q), JSON.stringify(eFriendQ));
    r = await Q.client.get('/api/friends');
    const qFriendE = r.data.friends.find((u) => u.id === E.user.id);
    check('unconfirmed: Protected\'s Friends entry for adult has NO number either', !!qFriendE && qFriendE.phone === null && !leaks(r.data, NUM.E), JSON.stringify(qFriendE));
    r = await Q.client.get('/api/people');
    const qSeesE = r.data.people.find((p) => p.id === E.user.id);
    check('unconfirmed: People hides the adult number too', !!qSeesE && qSeesE.phone === null && !leaks(r.data, NUM.E), JSON.stringify(qSeesE));
    r = await Q.client.get('/api/conversations');
    check('unconfirmed: conversations hide the adult number', !leaks(r.data, NUM.E), JSON.stringify(r.data));
    r = await Q.client.get(`/api/messages/${E.user.id}`);
    check('unconfirmed: thread itself stays closed (messaging gate, 403)', r.status === 403, `got ${r.status}`);

    // --- restart persistence ---
    console.log('Restarting server…');
    await stopServer(child);
    child = startServer(appDir, env);
    await waitReady(child);
    const A2b = new Client();
    const lr = await A2b.post('/api/login', { username: `da2_${RUN}`, password: 'test-pass-1' });
    check('login after restart works', lr.status === 200, `got ${lr.status}`);
    r = await A2b.get('/api/friends');
    const a1After = r.data.friends.find((u) => u.id === A1.user.id);
    check('friend\'s number survived restart', !!a1After && a1After.phone === NUM.A1, JSON.stringify(a1After));
    const A1b = new Client();
    await A1b.post('/api/login', { username: `da1_${RUN}`, password: 'test-pass-1' });
    r = await A1b.get('/api/me');
    check('own number survived restart', r.data.user.phone === NUM.A1, JSON.stringify(r.data.user));
  } finally {
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
