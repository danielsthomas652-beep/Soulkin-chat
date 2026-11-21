'use strict';
/* mLT. chat — photo direct messages end-to-end test suite.
 *
 * Real HTTP + a real WebSocket client against a real running server, in
 * the style of tests/messages-test.js. The app is copied to a throwaway
 * temp dir (node_modules symlinked) so the shipped data/solkin.db is
 * never touched. The temp database is PRE-CREATED with the old messages
 * schema (no media_url / media_type columns) so every run also proves
 * the startup migration adds them.
 *
 * Usage:
 *   node tests/message-photos-test.js                # local engine (photo -> /uploads/ file)
 *   node tests/message-photos-test.js --engine=libsql # Turso facade (photo -> media_blobs /media/:id)
 *
 * The rules under test:
 *   * A friend can send a photo DM (multipart, field 'media' like
 *     posts), with or without a caption; image-only is allowed.
 *   * The image is stored like post media and served back byte-identical
 *     at the message's mediaUrl; thread + conversations + the live WS
 *     'dm' push all carry the media fields.
 *   * The messaging gate is unchanged: non-friends 403, cross-band only
 *     for known_confirmed friendships, forced unconfirmed rows 403.
 *   * Neither text nor photo -> 400; a video file -> 400; a photo over
 *     the posts cap (5 MB) -> 413. Text-only JSON sends still work.
 *   * Photo messages survive a full server restart.
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

function photoForm(bytes, opts) {
  const o = opts || {};
  const fd = new FormData();
  if (o.text !== undefined) fd.append('text', o.text);
  if (!o.noFile) fd.append('media', new Blob([bytes], { type: o.type || 'image/png' }), o.filename || 'photo.png');
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-msgphotos-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: `file:${path.join(tmpRoot, 'cloud.db')}`, TURSO_AUTH_TOKEN: 'test-token', SESSION_SECRET: 'test-secret' }
    : {};
  const dbFile = ENGINE === 'libsql' ? path.join(tmpRoot, 'cloud.db') : path.join(appDir, 'data', 'solkin.db');
  console.log(`Message photos test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  // Pre-create the DB with the OLD messages schema (no media columns):
  // the server's startup migration must add them, like it will on the
  // real production database.
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const Database = require(path.join(APP_SRC, 'node_modules', 'better-sqlite3'));
  const pre = new Database(dbFile);
  pre.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at TEXT
  );`);
  const preCols = pre.prepare("SELECT name FROM pragma_table_info('messages')").all().map((c) => c.name);
  pre.close();
  check('pre-created DB really is the old schema (no media columns)', !preCols.includes('media_url') && !preCols.includes('media_type'), JSON.stringify(preCols));

  const sockets = [];
  let child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    // --- served UI ships the photo-DM pieces ---
    const html = await (await fetch(BASE + '/')).text();
    check('served HTML has the thread attach button + photo picker', html.includes('id="threadAttach"') && html.includes('id="threadPhotoFile"') && html.includes('accept="image/*"'));
    const js = await (await fetch(BASE + '/app.js')).text();
    check('served JS sends thread photos and previews them as 📷 Photo', js.includes('sendThreadPhoto') && js.includes('📷 Photo') && js.includes('bubble-photo'));
    check('served JS can aim the camera at the thread (editor path intact)', js.includes("openCamera('thread')") && js.includes("openCamera('editor')") && js.includes('setEditorFile(file'));

    const A = await signup('Adult A', { username: `pa_${RUN}` });
    const B = await signup('Adult B', { username: `pb_${RUN}` });
    const C = await signup('Stranger C', { username: `pc_${RUN}` });
    const P = await signup('Protected P', { username: `pp_${RUN}`, under18: true });
    const D = await signup('Adult D', { username: `pd_${RUN}` });
    check('signups succeed', [A, B, C, P, D].every((x) => x.status === 200 && x.user));

    // --- the gate applies to photos too ---
    let r = await A.client.postForm(`/api/messages/${C.user.id}`, photoForm(PNG_BYTES));
    check('non-friend photo send refused (403)', r.status === 403, `got ${r.status} ${JSON.stringify(r.data)}`);

    await befriend(A, B);
    await befriend(P, D, { knowsPerson: true });
    check('A-B friends; P-D cross-band confirmed friends', true);

    // --- photo-only message (also the migration proof: old-schema DB) ---
    r = await A.client.postForm(`/api/messages/${B.user.id}`, photoForm(PNG_BYTES));
    check('photo-only send succeeds on the migrated DB (200)', r.status === 200, `got ${r.status} ${JSON.stringify(r.data)}`);
    const photoMsg = r.data.message || {};
    check('photo message shape: text empty, mediaUrl set, mediaType image, mine=true',
      photoMsg.text === '' && typeof photoMsg.mediaUrl === 'string' && photoMsg.mediaUrl.length > 0 && photoMsg.mediaType === 'image' && photoMsg.mine === true,
      JSON.stringify(photoMsg));
    if (ENGINE === 'libsql') check('cloud mode stores the photo as a /media/:id blob', photoMsg.mediaUrl.startsWith('/media/'), photoMsg.mediaUrl);
    else check('local mode stores the photo as an /uploads/ file', photoMsg.mediaUrl.startsWith('/uploads/'), photoMsg.mediaUrl);

    // --- the stored photo serves back byte-identical ---
    const mediaRes = await fetch(BASE + photoMsg.mediaUrl);
    const served = Buffer.from(await mediaRes.arrayBuffer());
    check('photo serves back (200, image/png, byte-identical)', mediaRes.status === 200 && (mediaRes.headers.get('content-type') || '').includes('image/png') && served.equals(PNG_BYTES),
      `status ${mediaRes.status}, type ${mediaRes.headers.get('content-type')}, ${served.length} vs ${PNG_BYTES.length} bytes`);

    // --- photo + caption, profanity filtered ---
    r = await A.client.postForm(`/api/messages/${B.user.id}`, photoForm(PNG_BYTES, { text: 'damn nice view' }));
    check('photo + caption succeeds, caption profanity-filtered', r.status === 200 && !!r.data.message.mediaUrl && !/damn/i.test(r.data.message.text) && r.data.message.text.includes('****') && r.data.message.text.includes('nice view'),
      `got ${r.status} ${JSON.stringify(r.data.message)}`);

    // --- thread + conversations carry the media fields ---
    r = await B.client.get(`/api/messages/${A.user.id}`);
    const threadPhotos = (r.data.messages || []).filter((m) => m.mediaUrl);
    check('B thread shows both photo messages (mediaUrl + mediaType, mine=false)',
      r.status === 200 && threadPhotos.length === 2 && threadPhotos.every((m) => m.mediaType === 'image' && m.mine === false),
      JSON.stringify(r.data.messages));
    r = await B.client.get('/api/conversations');
    const bConvo = r.data.conversations.find((c) => c.user.id === A.user.id);
    check('B conversations: lastMessage carries the photo + caption', !!bConvo && !!bConvo.lastMessage && !!bConvo.lastMessage.mediaUrl && bConvo.lastMessage.text.includes('nice view'), JSON.stringify(bConvo && bConvo.lastMessage));

    // --- photo-only as the LAST message: fields the 📷 Photo preview needs ---
    r = await A.client.postForm(`/api/messages/${B.user.id}`, photoForm(PNG_BYTES));
    check('second photo-only send succeeds', r.status === 200, `got ${r.status}`);
    r = await B.client.get('/api/conversations');
    const bConvo2 = r.data.conversations.find((c) => c.user.id === A.user.id);
    check('photo-only lastMessage: mediaUrl set, text empty (client previews 📷 Photo)',
      !!bConvo2 && !!bConvo2.lastMessage && !!bConvo2.lastMessage.mediaUrl && bConvo2.lastMessage.text === '',
      JSON.stringify(bConvo2 && bConvo2.lastMessage));

    // --- refusals: neither, video, oversize ---
    r = await A.client.postForm(`/api/messages/${B.user.id}`, photoForm(null, { noFile: true }));
    check('multipart with neither text nor photo refused (400)', r.status === 400, `got ${r.status}`);
    r = await A.client.postForm(`/api/messages/${B.user.id}`, photoForm(Buffer.from('not a real video'), { type: 'video/mp4', filename: 'clip.mp4' }));
    check('video file as a message refused (400, pictures only)', r.status === 400 && /picture/i.test(r.data.error || ''), `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await A.client.postForm(`/api/messages/${B.user.id}`, photoForm(Buffer.alloc(5 * 1024 * 1024 + 1, 7)));
    check('photo over the 5 MB posts cap refused (413)', r.status === 413, `got ${r.status}`);

    // --- text-only JSON still works, media fields null ---
    r = await A.client.post(`/api/messages/${B.user.id}`, { text: 'plain text still fine' });
    check('text-only JSON send still works (mediaUrl null)', r.status === 200 && r.data.message.text === 'plain text still fine' && r.data.message.mediaUrl === null && r.data.message.mediaType === null,
      `got ${r.status} ${JSON.stringify(r.data.message)}`);

    // --- live WS push carries the media fields ---
    const wsB = new WsClient(B.client.cookieHeader()); sockets.push(wsB);
    await wsB.opened;
    await wsB.waitFor((m) => m.type === 'presence', 'B presence');
    r = await A.client.postForm(`/api/messages/${B.user.id}`, photoForm(PNG_BYTES));
    check('photo send while B online succeeds', r.status === 200, `got ${r.status}`);
    const liveUrl = r.data.message.mediaUrl;
    const dm = await wsB.waitFor((m) => m.type === 'dm' && m.message && m.message.mediaUrl === liveUrl, 'photo dm push to B');
    check('online recipient gets the dm push WITH media fields', !!dm && dm.message.mediaType === 'image' && dm.message.text === '' && dm.message.mine === false && !!dm.message.from, JSON.stringify(dm));
    wsB.close();

    // --- cross-band confirmed friends can send photos ---
    r = await P.client.postForm(`/api/messages/${D.user.id}`, photoForm(PNG_BYTES, { text: 'hi, a photo' }));
    check('Protected → adult confirmed friend photo succeeds (200)', r.status === 200 && !!r.data.message.mediaUrl, `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await D.client.get(`/api/messages/${P.user.id}`);
    check('D thread shows P\'s photo message', r.status === 200 && (r.data.messages || []).some((m) => m.mediaUrl && m.text === 'hi, a photo'), JSON.stringify(r.data.messages));

    // --- forced unconfirmed cross-band row: photos refused too ---
    const E = await signup('Adult E', { username: `pe_${RUN}` });
    const Q = await signup('Protected Q', { username: `pq_${RUN}`, under18: true });
    const raw = new Database(dbFile);
    try { raw.prepare("INSERT INTO friendships (requester_id, addressee_id, status, known_confirmed) VALUES (?, ?, 'accepted', 0)").run(E.user.id, Q.user.id); }
    finally { raw.close(); }
    r = await E.client.postForm(`/api/messages/${Q.user.id}`, photoForm(PNG_BYTES));
    check('unconfirmed cross-band photo refused, adult side (403)', r.status === 403, `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await Q.client.postForm(`/api/messages/${E.user.id}`, photoForm(PNG_BYTES));
    check('unconfirmed cross-band photo refused, Protected side (403)', r.status === 403, `got ${r.status}`);

    // --- restart persistence ---
    console.log('Restarting server…');
    await stopServer(child);
    child = startServer(appDir, env);
    await waitReady(child);
    const Bb = new Client();
    const lr = await Bb.post('/api/login', { username: `pb_${RUN}`, password: 'test-pass-1' });
    check('login after restart works', lr.status === 200, `got ${lr.status}`);
    r = await Bb.get(`/api/messages/${A.user.id}`);
    const afterPhotos = (r.data.messages || []).filter((m) => m.mediaUrl);
    check('photo messages survived restart (4 photo messages in thread)', r.status === 200 && afterPhotos.length === 4, `got ${afterPhotos.length}: ${JSON.stringify((r.data.messages || []).map((m) => ({ t: m.text, media: !!m.mediaUrl })))}`);
    const again = await fetch(BASE + photoMsg.mediaUrl);
    const againBytes = Buffer.from(await again.arrayBuffer());
    check('first photo still serves byte-identical after restart', again.status === 200 && againBytes.equals(PNG_BYTES), `status ${again.status}`);
  } finally {
    for (const s of sockets) s.close();
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
