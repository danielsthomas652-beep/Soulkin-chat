'use strict';
/* mLT. chat — disappearing snaps (Snapchat-style) end-to-end test suite.
 *
 * Real HTTP + real WebSocket clients against a real running server, in
 * the style of tests/message-photos-test.js. The app is copied to a
 * throwaway temp dir (node_modules symlinked) so the shipped
 * data/solkin.db is never touched. The temp database is PRE-CREATED
 * with the photo-DM-era messages schema (media_url / media_type
 * present, is_snap / opened_at absent) so every run also proves the
 * startup migration adds the snap columns.
 *
 * Usage:
 *   node tests/snaps-test.js                # local engine (snap -> /uploads/ file)
 *   node tests/snaps-test.js --engine=libsql # Turso facade (snap -> media_blobs /media/:id)
 *
 * The rules under test:
 *   * A friend can send a snap (multipart media + snap=1, camera-style
 *     image, optional caption) through the SAME messaging gate as text
 *     and photos: non-friends 403, cross-band only for known_confirmed
 *     friendships, forced unconfirmed rows refused both ways.
 *   * SECRECY: no payload ever carries a snap's mediaUrl — not the
 *     send response, not either side's thread, not conversations, not
 *     the live WS 'dm' push. Payloads carry only isSnap + snapOpened.
 *   * The reveal: POST /api/messages/:messageId/open — recipient only,
 *     unopened only — returns the image bytes byte-identical exactly
 *     once; in the same request the stored picture is deleted, so the
 *     old media URL 404s and a second open is a 410. The sender can
 *     never open their own snap (403); strangers get 403; anonymous
 *     gets 401. The sender gets a live {type:'snap-opened'} push.
 *   * Tombstones: after opening, both threads and the conversation
 *     preview fields show the snap as opened; the row stays, the
 *     picture does not. An UNOPENED snap survives a full restart and
 *     can still be opened afterwards.
 *   * Refusals: snap without a picture -> 400; video snap -> 400;
 *     photo over the 5 MB cap -> 413. A regular photo DM still carries
 *     its mediaUrl (no regression).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=local').split('=')[1];
const APP_SRC = path.join(__dirname, '..');
const PORT = 3750 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Math.random().toString(36).slice(2, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A real 1x1 PNG, and its exact bytes (served-back comparison).
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

class Client {
  constructor() { this.cookies = new Map(); }
  storeCookies(res) {
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const k = pair.slice(0, eq).trim(), v = pair.slice(eq + 1).trim();
        if (v) this.cookies.set(k, v); else this.cookies.delete(k);
      }
    }
  }
  async req(method, p, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    this.storeCookies(res);
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { status: res.status, data };
  }
  async postForm(p, fd) {
    const headers = {};
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method: 'POST', headers, body: fd });
    this.storeCookies(res);
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { status: res.status, data };
  }
  // Raw POST for the snap-open endpoint, which streams image bytes
  // (or a JSON error) instead of a JSON body.
  async rawPost(p) {
    const headers = {};
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method: 'POST', headers });
    this.storeCookies(res);
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, contentType: res.headers.get('content-type') || '', buf };
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
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

function snapForm(bytes, opts) {
  const o = opts || {};
  const fd = new FormData();
  if (o.text !== undefined) fd.append('text', o.text);
  fd.append('snap', '1');
  if (!o.noFile) fd.append('media', new Blob([bytes], { type: o.type || 'image/png' }), o.filename || 'snap.png');
  return fd;
}
function photoForm(bytes) {
  const fd = new FormData();
  fd.append('media', new Blob([bytes], { type: 'image/png' }), 'photo.png');
  return fd;
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-snaps-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: `file:${path.join(tmpRoot, 'cloud.db')}`, TURSO_AUTH_TOKEN: 'test-token', SESSION_SECRET: 'test-secret' }
    : {};
  const dbFile = ENGINE === 'libsql' ? path.join(tmpRoot, 'cloud.db') : path.join(appDir, 'data', 'solkin.db');
  console.log(`Snaps test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  const Database = require(path.join(APP_SRC, 'node_modules', 'better-sqlite3'));
  function readMsgRow(id) {
    const raw = new Database(dbFile);
    try { return raw.prepare('SELECT * FROM messages WHERE id = ?').get(id); } finally { raw.close(); }
  }
  function msgCols() {
    const raw = new Database(dbFile);
    try { return raw.prepare("SELECT name FROM pragma_table_info('messages')").all().map((c) => c.name); } finally { raw.close(); }
  }

  // Pre-create the DB with the PHOTO-ERA messages schema (media columns
  // present, snap columns absent): the startup migration must add
  // is_snap / opened_at, like it will on the real production database.
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const pre = new Database(dbFile);
  pre.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    media_url TEXT,
    media_type TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at TEXT
  );`);
  const preCols = pre.prepare("SELECT name FROM pragma_table_info('messages')").all().map((c) => c.name);
  pre.close();
  check('pre-created DB is the photo-era schema (media cols yes, snap cols no)',
    preCols.includes('media_url') && preCols.includes('media_type') && !preCols.includes('is_snap') && !preCols.includes('opened_at'),
    JSON.stringify(preCols));

  const sockets = [];
  let child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');
    check('startup migration added is_snap + opened_at to messages', (() => { const c = msgCols(); return c.includes('is_snap') && c.includes('opened_at'); })(), JSON.stringify(msgCols()));

    // --- served UI ships the snap pieces ---
    const html = await (await fetch(BASE + '/')).text();
    check('served HTML has the snap viewer overlay', html.includes('id="snapView"') && html.includes('id="snapImg"') && html.includes('id="snapClose"'));
    const js = await (await fetch(BASE + '/app.js')).text();
    check('served JS: attach sheet gains the Snap choice, camera gains the snap target',
      js.includes('📸 Snap — disappears after they see it') && js.includes("openCamera('snap')") && js.includes('sendThreadSnap') && js.includes("append('snap', '1')"));
    check('served JS: tap-to-view chip, one-time open call, snap-opened live flip, snap previews',
      js.includes('📸 Snap — tap to view') && js.includes("/open'") && js.includes('snap-opened') && js.includes('📸 Snap opened'));
    const css = await (await fetch(BASE + '/style.css')).text();
    check('served CSS styles the snap chip + viewer', css.includes('.snap-chip') && css.includes('.snap-stage'));

    const A = await signup('Adult A', { username: `sa_${RUN}` });
    const B = await signup('Adult B', { username: `sb_${RUN}` });
    const C = await signup('Stranger C', { username: `sc_${RUN}` });
    check('signups succeed', [A, B, C].every((x) => x.status === 200 && x.user));

    // --- the gate applies to snaps too ---
    let r = await A.client.postForm(`/api/messages/${C.user.id}`, snapForm(PNG_BYTES));
    check('non-friend snap send refused (403)', r.status === 403, `got ${r.status} ${JSON.stringify(r.data)}`);

    await befriend(A, B);
    check('A-B friends', true);

    // --- refusals before any good snap ---
    r = await A.client.postForm(`/api/messages/${B.user.id}`, snapForm(null, { noFile: true, text: 'words only' }));
    check('snap with no picture refused (400, needs a picture)', r.status === 400 && /picture/i.test(r.data.error || ''), `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await A.client.postForm(`/api/messages/${B.user.id}`, snapForm(Buffer.from('not a real video'), { type: 'video/mp4', filename: 'clip.mp4' }));
    check('video snap refused (400, pictures only)', r.status === 400 && /picture/i.test(r.data.error || ''), `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await A.client.postForm(`/api/messages/${B.user.id}`, snapForm(Buffer.alloc(5 * 1024 * 1024 + 1, 7)));
    check('snap over the 5 MB cap refused (413)', r.status === 413, `got ${r.status}`);

    // Live sockets for both sides: B watches for the dm push, A for the
    // snap-opened push.
    const wsB = new WsClient(B.client.cookieHeader()); sockets.push(wsB);
    await wsB.opened;
    await wsB.waitFor((m) => m.type === 'presence', 'B presence');
    const wsA = new WsClient(A.client.cookieHeader()); sockets.push(wsA);
    await wsA.opened;
    await wsA.waitFor((m) => m.type === 'presence', 'A presence');

    // --- snap 1: with a caption ---
    r = await A.client.postForm(`/api/messages/${B.user.id}`, snapForm(PNG_BYTES, { text: 'a secret sunset' }));
    check('snap send succeeds (200)', r.status === 200, `got ${r.status} ${JSON.stringify(r.data)}`);
    const snap1 = r.data.message || {};
    check('snap shape: isSnap true, snapOpened false, openedAt null, caption kept, mine=true',
      snap1.isSnap === true && snap1.snapOpened === false && snap1.openedAt === null && snap1.text === 'a secret sunset' && snap1.mine === true,
      JSON.stringify(snap1));
    check('send response NEVER carries the snap mediaUrl/mediaType', snap1.mediaUrl === null && snap1.mediaType === null, JSON.stringify(snap1));
    const stored1 = readMsgRow(snap1.id);
    check('server stored the picture (media_url set in DB, is_snap=1, opened_at null)',
      !!stored1 && !!stored1.media_url && stored1.is_snap === 1 && !stored1.opened_at, JSON.stringify(stored1));
    const storedUrl1 = stored1.media_url;
    if (ENGINE === 'libsql') check('cloud mode stores the snap as a /media/:id blob', storedUrl1.startsWith('/media/'), storedUrl1);
    else check('local mode stores the snap as an /uploads/ file', storedUrl1.startsWith('/uploads/'), storedUrl1);
    const preOpen = await fetch(BASE + storedUrl1);
    const preBytes = Buffer.from(await preOpen.arrayBuffer());
    check('stored picture exists server-side before opening (200, byte-identical)', preOpen.status === 200 && preBytes.equals(PNG_BYTES), `status ${preOpen.status}`);

    // --- secrecy in thread payloads, both sides ---
    r = await B.client.get(`/api/messages/${A.user.id}`);
    const bSnap1 = (r.data.messages || []).find((m) => m.id === snap1.id);
    check('B thread: snap present with isSnap, snapOpened=false, mediaUrl null',
      !!bSnap1 && bSnap1.isSnap === true && bSnap1.snapOpened === false && bSnap1.mediaUrl === null, JSON.stringify(bSnap1));
    check('B thread payload never contains the stored media URL', !JSON.stringify(r.data).includes(storedUrl1));
    r = await A.client.get(`/api/messages/${B.user.id}`);
    const aSnap1 = (r.data.messages || []).find((m) => m.id === snap1.id);
    check('A thread: same secrecy for the sender', !!aSnap1 && aSnap1.mediaUrl === null && !JSON.stringify(r.data).includes(storedUrl1), JSON.stringify(aSnap1));

    // --- snap 2: no caption, watched live over WS ---
    r = await A.client.postForm(`/api/messages/${B.user.id}`, snapForm(PNG_BYTES));
    check('second snap send succeeds', r.status === 200, `got ${r.status}`);
    const snap2 = r.data.message || {};
    const storedUrl2 = readMsgRow(snap2.id).media_url;
    const dm = await wsB.waitFor((m) => m.type === 'dm' && m.message && m.message.id === snap2.id, 'snap dm push to B');
    check('WS dm push: isSnap true, mediaUrl null, snapOpened false, sender attached',
      !!dm && dm.message.isSnap === true && dm.message.mediaUrl === null && dm.message.snapOpened === false && !!dm.message.from, JSON.stringify(dm));
    check('WS dm push never contains the stored media URL', !JSON.stringify(dm).includes(storedUrl2));

    // --- who may NOT open ---
    let op = await A.client.rawPost(`/api/messages/${snap1.id}/open`);
    check('sender opening their own snap refused (403)', op.status === 403, `got ${op.status}`);
    op = await C.client.rawPost(`/api/messages/${snap1.id}/open`);
    check('third party opening a snap refused (403)', op.status === 403, `got ${op.status}`);
    const anon = await fetch(BASE + `/api/messages/${snap1.id}/open`, { method: 'POST' });
    check('anonymous open refused (401)', anon.status === 401, `got ${anon.status}`);
    op = await B.client.rawPost('/api/messages/999999/open');
    check('opening a nonexistent snap is a 404', op.status === 404, `got ${op.status}`);

    // --- the one reveal ---
    op = await B.client.rawPost(`/api/messages/${snap1.id}/open`);
    check('recipient open succeeds (200, image/png, byte-identical)',
      op.status === 200 && op.contentType.includes('image/png') && op.buf.equals(PNG_BYTES),
      `status ${op.status}, type ${op.contentType}, ${op.buf.length} vs ${PNG_BYTES.length} bytes`);
    const push = await wsA.waitFor((m) => m.type === 'snap-opened' && m.messageId === snap1.id, 'snap-opened push to A');
    check('sender got the live snap-opened push (messageId + opener userId)', push.userId === B.user.id, JSON.stringify(push));
    const deadRes = await fetch(BASE + storedUrl1);
    check('old media URL is dead after opening (404)', deadRes.status === 404, `got ${deadRes.status}`);
    op = await B.client.rawPost(`/api/messages/${snap1.id}/open`);
    let secondErr = '';
    try { secondErr = JSON.parse(op.buf.toString()).error || ''; } catch (e) { /* not JSON */ }
    check('second open refused (410, plain-language "already opened")', op.status === 410 && /already opened/i.test(secondErr), `got ${op.status} ${op.buf.toString().slice(0, 120)}`);
    const afterRow = readMsgRow(snap1.id);
    check('DB tombstone: media_url nulled, opened_at set, row + caption survive',
      !!afterRow && afterRow.media_url === null && !!afterRow.opened_at && afterRow.text === 'a secret sunset', JSON.stringify(afterRow));

    // --- tombstones in threads + conversation previews ---
    r = await B.client.get(`/api/messages/${A.user.id}`);
    const bSnap1After = (r.data.messages || []).find((m) => m.id === snap1.id);
    const bSnap2 = (r.data.messages || []).find((m) => m.id === snap2.id);
    check('B thread after open: snap1 tombstone (snapOpened true, mediaUrl null), snap2 still unopened',
      !!bSnap1After && bSnap1After.snapOpened === true && bSnap1After.mediaUrl === null && !!bSnap2 && bSnap2.snapOpened === false,
      JSON.stringify({ bSnap1After, bSnap2 }));
    r = await A.client.get(`/api/messages/${B.user.id}`);
    const aSnap1After = (r.data.messages || []).find((m) => m.id === snap1.id);
    check('A thread after open: sender sees the tombstone too', !!aSnap1After && aSnap1After.snapOpened === true && aSnap1After.mediaUrl === null, JSON.stringify(aSnap1After));
    r = await A.client.get('/api/conversations');
    const aConvo = r.data.conversations.find((c) => c.user.id === B.user.id);
    check('A conversations: lastMessage is the unopened snap2 (📸 Snap preview fields)',
      !!aConvo && !!aConvo.lastMessage && aConvo.lastMessage.id === snap2.id && aConvo.lastMessage.isSnap === true && aConvo.lastMessage.snapOpened === false && aConvo.lastMessage.mediaUrl === null,
      JSON.stringify(aConvo && aConvo.lastMessage));
    op = await B.client.rawPost(`/api/messages/${snap2.id}/open`);
    check('B opens snap2 (200, byte-identical)', op.status === 200 && op.buf.equals(PNG_BYTES), `got ${op.status}`);
    r = await A.client.get('/api/conversations');
    const aConvo2 = r.data.conversations.find((c) => c.user.id === B.user.id);
    check('A conversations: lastMessage now the opened snap2 (📸 Snap opened preview fields)',
      !!aConvo2 && !!aConvo2.lastMessage && aConvo2.lastMessage.isSnap === true && aConvo2.lastMessage.snapOpened === true,
      JSON.stringify(aConvo2 && aConvo2.lastMessage));

    // --- regular photo DM: no regression ---
    r = await A.client.postForm(`/api/messages/${B.user.id}`, photoForm(PNG_BYTES));
    check('regular photo DM still carries its mediaUrl and isSnap=false',
      r.status === 200 && !!r.data.message.mediaUrl && r.data.message.isSnap === false && r.data.message.snapOpened === false,
      `got ${r.status} ${JSON.stringify(r.data.message)}`);

    // --- cross-band confirmed friends can snap ---
    const P = await signup('Protected P', { username: `sp_${RUN}`, under18: true });
    const D = await signup('Adult D', { username: `sd_${RUN}` });
    await befriend(P, D, { knowsPerson: true });
    r = await P.client.postForm(`/api/messages/${D.user.id}`, snapForm(PNG_BYTES));
    check('Protected → adult confirmed friend snap succeeds (200, secret shape)',
      r.status === 200 && r.data.message.isSnap === true && r.data.message.mediaUrl === null, `got ${r.status} ${JSON.stringify(r.data)}`);
    const pSnap = r.data.message || {};
    r = await D.client.get(`/api/messages/${P.user.id}`);
    check('D thread shows the snap without any mediaUrl', r.status === 200 && (r.data.messages || []).some((m) => m.id === pSnap.id && m.isSnap && m.mediaUrl === null), JSON.stringify(r.data.messages));
    op = await D.client.rawPost(`/api/messages/${pSnap.id}/open`);
    check('D can open the cross-band snap exactly once (200, byte-identical)', op.status === 200 && op.buf.equals(PNG_BYTES), `got ${op.status}`);

    // --- forced unconfirmed cross-band row: snaps refused too ---
    const E = await signup('Adult E', { username: `se_${RUN}` });
    const Q = await signup('Protected Q', { username: `sq_${RUN}`, under18: true });
    const raw = new Database(dbFile);
    try { raw.prepare("INSERT INTO friendships (requester_id, addressee_id, status, known_confirmed) VALUES (?, ?, 'accepted', 0)").run(E.user.id, Q.user.id); }
    finally { raw.close(); }
    r = await E.client.postForm(`/api/messages/${Q.user.id}`, snapForm(PNG_BYTES));
    check('unconfirmed cross-band snap refused, adult side (403)', r.status === 403, `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await Q.client.postForm(`/api/messages/${E.user.id}`, snapForm(PNG_BYTES));
    check('unconfirmed cross-band snap refused, Protected side (403)', r.status === 403, `got ${r.status}`);

    // --- an unopened snap survives a restart, then opens ---
    r = await A.client.postForm(`/api/messages/${B.user.id}`, snapForm(PNG_BYTES, { text: 'see you after the restart' }));
    check('pre-restart snap send succeeds', r.status === 200, `got ${r.status}`);
    const snap3 = r.data.message || {};
    const storedUrl3 = readMsgRow(snap3.id).media_url;
    for (const s of sockets) s.close();
    console.log('Restarting server…');
    await stopServer(child);
    child = startServer(appDir, env);
    await waitReady(child);
    const Bb = new Client();
    const lr = await Bb.post('/api/login', { username: `sb_${RUN}`, password: 'test-pass-1' });
    check('login after restart works', lr.status === 200, `got ${lr.status}`);
    r = await Bb.get(`/api/messages/${A.user.id}`);
    const bSnap3 = (r.data.messages || []).find((m) => m.id === snap3.id);
    check('unopened snap survived restart (isSnap, unopened, still no mediaUrl)',
      !!bSnap3 && bSnap3.isSnap === true && bSnap3.snapOpened === false && bSnap3.mediaUrl === null && !JSON.stringify(r.data).includes(storedUrl3),
      JSON.stringify(bSnap3));
    op = await Bb.rawPost(`/api/messages/${snap3.id}/open`);
    check('snap still opens after restart (200, byte-identical)', op.status === 200 && op.buf.equals(PNG_BYTES), `got ${op.status}`);
    const dead3 = await fetch(BASE + storedUrl3);
    check('its media URL is dead after the post-restart open (404)', dead3.status === 404, `got ${dead3.status}`);
  } finally {
    for (const s of sockets) s.close();
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
