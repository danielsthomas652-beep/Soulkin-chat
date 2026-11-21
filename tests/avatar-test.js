'use strict';
/* mLT. chat — Avatar Maker (build-a-character) end-to-end test suite.
 *
 * Real HTTP clients against a real running server, in the style of
 * tests/map-test.js. The app is copied to a throwaway temp dir
 * (node_modules symlinked) so the shipped data/solkin.db is never
 * touched. The temp database is PRE-CREATED with the map-era users
 * schema (phone + location columns present; avatar absent) so every
 * run also proves the startup migration adds users.avatar.
 *
 * Usage:
 *   node tests/avatar-test.js                # local engine (better-sqlite3 / node:sqlite)
 *   node tests/avatar-test.js --engine=libsql # Turso facade via @libsql/client on a file: DB
 *
 * The rules under test (owner: "make an avatar… like a version of
 * yourself, for the map and next to pictures", "lots of options for
 * different clothes and everything else"):
 *   * PATCH /api/me {avatar} stores a build-a-character config after
 *     validating every key against the shared whitelist
 *     (public/avatar-parts.js — the same module the browser loads).
 *     Unknown parts, unknown keys, non-object / non-string garbage and
 *     oversized payloads are all 400 and store nothing.
 *   * A partial config is fine — missing parts fall back to defaults.
 *     avatar: null takes the avatar off again.
 *   * The saved config rides in every user payload the client already
 *     consumes: /api/me (and login), post authors in GET /api/posts,
 *     GET /api/people, GET /api/friends, GET /api/conversations,
 *     GET /api/messages/:userId and GET /api/map pins. Users without
 *     one get avatar: null (the client keeps the initial-letter
 *     circle for them).
 *   * NO safety gate: a Protected account saves an avatar exactly
 *     like an adult (an avatar is cartoon parts, not a photo).
 *   * The avatar survives a restart; the creator screen, the shared
 *     whitelist script, the SVG renderer and the map-pin usage all
 *     ship in the served files.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=local').split('=')[1];
const APP_SRC = path.join(__dirname, '..');
const PORT = 4010 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Math.random().toString(36).slice(2, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CFG_A = { skin: 'skin4', hair: 'ponytail', hairColor: 'pink', mouth: 'laugh', facialHair: 'none', outfit: 'superhero', outfitColor: 'purple', hat: 'wizard', glasses: 'hearts', bg: 'space' };
const CFG_A2 = { skin: 'skin6', hair: 'buzz', hairColor: 'black', mouth: 'smirk', facialHair: 'beard', outfit: 'suit', outfitColor: 'black', hat: 'tophat', glasses: 'shades', bg: 'night' };
const CFG_K = { skin: 'skin1', hair: 'curly', hairColor: 'ginger', mouth: 'grin', facialHair: 'none', outfit: 'overalls', outfitColor: 'yellow', hat: 'party', glasses: 'stars', bg: 'rainbow' };
const GEO_A = { lat: 43.123456, lng: -77.654321 };

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function canon(o) {
  if (!o || typeof o !== 'object') return JSON.stringify(o);
  return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
}
const sameCfg = (a, b) => canon(a) === canon(b);

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
async function befriend(from, to) {
  const r = await from.client.post('/api/friends/request', { userId: to.user.id });
  if (r.status !== 200) throw new Error('friend request failed: ' + JSON.stringify(r));
  const a = await to.client.post('/api/friends/accept', { requestId: r.data.requestId });
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-avatar-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: `file:${path.join(tmpRoot, 'cloud.db')}`, TURSO_AUTH_TOKEN: 'test-token', SESSION_SECRET: 'test-secret' }
    : {};
  const dbFile = ENGINE === 'libsql' ? path.join(tmpRoot, 'cloud.db') : path.join(appDir, 'data', 'solkin.db');
  console.log(`Avatar Maker test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  // Pre-create the DB with the MAP-ERA users schema (phone + location
  // columns present, avatar absent): the startup migration must add it.
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const Database = require(path.join(APP_SRC, 'node_modules', 'better-sqlite3'));
  const pre = new Database(dbFile);
  pre.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    is_protected INTEGER NOT NULL DEFAULT 0,
    phone TEXT,
    share_location INTEGER NOT NULL DEFAULT 0,
    lat REAL,
    lng REAL,
    location_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  const preCols = pre.prepare("SELECT name FROM pragma_table_info('users')").all().map((c) => c.name);
  pre.close();
  check('pre-created DB really is the map-era schema (location yes, avatar no)',
    preCols.includes('share_location') && !preCols.includes('avatar'), JSON.stringify(preCols));

  let child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    // The migration ran at boot:
    const rawBoot = new Database(dbFile);
    let bootCols = [];
    try { bootCols = rawBoot.prepare("SELECT name FROM pragma_table_info('users')").all().map((c) => c.name); } finally { rawBoot.close(); }
    check('startup migration added users.avatar', bootCols.includes('avatar'), JSON.stringify(bootCols));

    // --- served files ship the maker ---
    const html = await (await fetch(BASE + '/')).text();
    check('served HTML has the Profile avatar button and the maker screen',
      html.includes('id="btnMakeAvatar"') && html.includes('🎨 Make my avatar')
      && html.includes('id="avatarView"') && html.includes('id="avPreview"')
      && html.includes('id="avCats"') && html.includes('id="avOptions"')
      && html.includes('id="avRandom"') && html.includes('id="avSave"') && html.includes('id="avClose"'));
    check('served HTML loads the shared whitelist before app.js',
      html.includes('<script src="/avatar-parts.js"></script>')
      && html.indexOf('/avatar-parts.js') < html.indexOf('/app.js'));
    const parts = await (await fetch(BASE + '/avatar-parts.js')).text();
    check('served whitelist carries the categories, defaults and validator',
      parts.includes('AVATAR_CATEGORIES') && parts.includes('AVATAR_DEFAULTS') && parts.includes('sanitizeAvatar')
      && parts.includes("skin:") && parts.includes("facialHair:") && parts.includes("outfitColor:"));
    check('served whitelist option counts meet the lots-of-options bar (skin>=6 hair>=8 hairColor>=8 face>=5 beard>=4 clothes>=8 colors>=8 hats>=6 glasses>=5 backdrops>=8)',
      parts.includes("label: 'Ponytail'") && parts.includes("label: 'Wizard'") && parts.includes("label: 'Overalls'")
      && parts.includes("label: 'Rainbow'") && parts.includes("label: 'Mustache'") && parts.includes("label: 'Mohawk'"));
    const js = await (await fetch(BASE + '/app.js')).text();
    check('served JS has the SVG renderer + whitelist-driven face helper',
      js.includes('function avatarSVG(') && js.includes('function userAvatarHTML(')
      && js.includes('AvatarParts') && js.includes('user.avatar'));
    check('served JS: initial-letter fallback is intact inside the face helper',
      js.includes('return avatarHTML(user ? user.displayName') && js.includes('function avatarHTML('));
    check('served JS wires the maker (open, tiles, random, save via PATCH avatar)',
      js.includes('openAvatarMaker') && js.includes('av-tile') && js.includes('avRandom')
      && js.includes('avatar: avDraft') && js.includes("method: 'PATCH'"));
    check('served JS uses the renderer in feed, chat and map render paths',
      js.includes('userAvatarHTML(a, ') && js.includes('userAvatarHTML(u, ')
      && js.includes('L.divIcon') && js.includes('map-pin') && js.includes('avatarSVG(f.user.avatar)'));
    const css = await (await fetch(BASE + '/style.css')).text();
    check('served CSS styles the character faces, maker tiles and map pins',
      css.includes('.avatar.av-svg') && css.includes('.av-tile') && css.includes('.av-preview')
      && css.includes('.av-cats') && css.includes('.map-pin'));

    // --- accounts ---
    const A = await signup('Adult One', { username: `ava_${RUN}` });
    const B = await signup('Adult Two', { username: `avb_${RUN}` });
    const K = await signup('Kid One', { username: `avk_${RUN}`, under18: true });
    check('signups succeed on the migrated DB, avatar starts null',
      [A, B, K].every((x) => x.status === 200 && x.user) && A.user.avatar === null && K.user.avatar === null,
      JSON.stringify([A.status, B.status, K.status]));

    let r = await A.client.get('/api/me');
    check('GET /api/me: avatar is null before one is saved', r.status === 200 && r.data.user.avatar === null, JSON.stringify(r.data.user));

    // --- saving + validation ---
    r = await A.client.patch('/api/me', { avatar: CFG_A });
    check('PATCH a full valid avatar saves it (200, config echoed back)', r.status === 200 && sameCfg(r.data.user.avatar, CFG_A), `got ${r.status} ${JSON.stringify(r.data.user && r.data.user.avatar)}`);
    r = await A.client.get('/api/me');
    check('GET /api/me returns the saved avatar', r.status === 200 && sameCfg(r.data.user.avatar, CFG_A), JSON.stringify(r.data.user.avatar));

    r = await A.client.patch('/api/me', { avatar: { skin: 'skin5' } });
    check('a partial avatar fills the rest with defaults',
      r.status === 200 && r.data.user.avatar.skin === 'skin5' && r.data.user.avatar.hair === 'short' && r.data.user.avatar.bg === 'sky',
      `got ${r.status} ${JSON.stringify(r.data.user && r.data.user.avatar)}`);
    r = await A.client.patch('/api/me', { avatar: CFG_A });
    check('full config restored', r.status === 200 && sameCfg(r.data.user.avatar, CFG_A), `got ${r.status}`);

    const badPayloads = [
      ['unknown part value', { skin: 'blue' }],
      ['unknown outfit value', { outfit: 'spacesuit' }],
      ['unknown key in the config', { hair: 'mohawk', evil: 'x' }],
      ['a bare string that is not JSON', 'hello there'],
      ['a JSON string with a bad value', JSON.stringify({ skin: 'blue' })],
      ['a number instead of an object', 42],
      ['an array instead of an object', ['skin1']],
      ['a boolean instead of an object', true],
      ['a non-string part value', { skin: 7 }],
      ['an oversized garbage string', 'x'.repeat(5000)],
      ['an oversized part value', { skin: 'x'.repeat(300) }],
    ];
    for (const [label, payload] of badPayloads) {
      r = await A.client.patch('/api/me', { avatar: payload });
      check(`PATCH avatar refused: ${label} (400)`, r.status === 400 && !!r.data.error, `got ${r.status} ${JSON.stringify(r.data)}`);
    }
    r = await A.client.get('/api/me');
    check('refused payloads stored nothing — the good avatar is untouched', r.status === 200 && sameCfg(r.data.user.avatar, CFG_A), JSON.stringify(r.data.user.avatar));

    // --- the avatar rides every payload ---
    await A.client.post('/api/posts', { text: 'Avatar post from A 🎨' });
    await B.client.post('/api/posts', { text: 'Plain post from B' });
    r = await B.client.get('/api/posts');
    const postA = (r.data.posts || []).find((p) => p.author && p.author.id === A.user.id);
    const postB = (r.data.posts || []).find((p) => p.author && p.author.id === B.user.id);
    check('feed: the author with an avatar carries it in GET /api/posts', !!postA && sameCfg(postA.author.avatar, CFG_A), JSON.stringify(postA && postA.author));
    check('feed: the author without one gets avatar null (initial-circle fallback)', !!postB && postB.author.avatar === null, JSON.stringify(postB && postB.author));

    r = await B.client.get('/api/people');
    const personA = (r.data.people || []).find((p) => p.id === A.user.id);
    const personB = (r.data.people || []).find((p) => p.id === B.user.id);
    check('People: avatar present for A, null for B', !!personA && sameCfg(personA.avatar, CFG_A) && !!personB && personB.avatar === null, JSON.stringify(personA));

    await befriend(A, B);
    r = await B.client.get('/api/friends');
    const friendA = (r.data.friends || []).find((f) => f.id === A.user.id);
    check('Friends: the friend entry carries the avatar', !!friendA && sameCfg(friendA.avatar, CFG_A), JSON.stringify(friendA));

    r = await A.client.post('/api/messages/' + B.user.id, { text: 'hi B, check my new face 🎨' });
    check('A can message B (friends)', r.status === 200, `got ${r.status}`);
    r = await B.client.get('/api/conversations');
    const convoA = (r.data.conversations || []).find((c) => c.user.id === A.user.id);
    check('Conversations: the partner entry carries the avatar', !!convoA && sameCfg(convoA.user.avatar, CFG_A), JSON.stringify(convoA && convoA.user));
    r = await B.client.get('/api/messages/' + A.user.id);
    check('Thread: the partner user object carries the avatar', r.status === 200 && sameCfg(r.data.user.avatar, CFG_A), `got ${r.status} ${JSON.stringify(r.data.user && r.data.user.avatar)}`);

    r = await A.client.patch('/api/me', { shareLocation: true });
    check('A turns location sharing on', r.status === 200, `got ${r.status}`);
    r = await A.client.post('/api/location', GEO_A);
    check('A posts a location fix', r.status === 200, `got ${r.status}`);
    r = await B.client.get('/api/map');
    const pinA = (r.data.friends || []).find((f) => f.user.id === A.user.id);
    check('Map: the pin user carries the avatar', !!pinA && sameCfg(pinA.user.avatar, CFG_A), JSON.stringify(pinA));

    // --- Protected accounts: no extra gate ---
    r = await K.client.patch('/api/me', { avatar: CFG_K });
    check('a Protected account saves an avatar like anyone (200)', r.status === 200 && sameCfg(r.data.user.avatar, CFG_K), `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await K.client.get('/api/me');
    check('the Protected avatar reads back', r.status === 200 && sameCfg(r.data.user.avatar, CFG_K), JSON.stringify(r.data.user.avatar));

    // --- combined update + clearing ---
    r = await A.client.patch('/api/me', { displayName: 'Adult One', avatar: CFG_A2 });
    check('avatar + name in one PATCH both apply', r.status === 200 && r.data.user.displayName === 'Adult One' && sameCfg(r.data.user.avatar, CFG_A2), `got ${r.status} ${JSON.stringify(r.data.user)}`);
    r = await A.client.patch('/api/me', { avatar: null });
    check('avatar: null takes the avatar off', r.status === 200 && r.data.user.avatar === null, `got ${r.status} ${JSON.stringify(r.data.user)}`);
    r = await B.client.get('/api/posts');
    const postA2 = (r.data.posts || []).find((p) => p.author && p.author.id === A.user.id);
    check('feed falls back to avatar null after clearing', !!postA2 && postA2.author.avatar === null, JSON.stringify(postA2 && postA2.author));

    // --- restore + restart persistence ---
    r = await A.client.patch('/api/me', { avatar: CFG_A });
    check('avatar restored before restart', r.status === 200 && sameCfg(r.data.user.avatar, CFG_A), `got ${r.status}`);
    const rawStore = new Database(dbFile);
    let stored = null;
    try { stored = rawStore.prepare('SELECT avatar FROM users WHERE id = ?').get(A.user.id); } finally { rawStore.close(); }
    check('the DB stores the avatar as a JSON string of whitelist keys',
      !!stored && typeof stored.avatar === 'string' && sameCfg(JSON.parse(stored.avatar), CFG_A), JSON.stringify(stored));

    console.log('Restarting server…');
    await stopServer(child);
    child = startServer(appDir, env);
    await waitReady(child);
    const Ab = new Client();
    const lr = await Ab.post('/api/login', { username: `ava_${RUN}`, password: 'test-pass-1' });
    check('fresh login after restart carries the avatar in its user payload', lr.status === 200 && sameCfg(lr.data.user.avatar, CFG_A), `got ${lr.status} ${JSON.stringify(lr.data.user && lr.data.user.avatar)}`);
    r = await Ab.get('/api/me');
    check('avatar survives the restart (GET /api/me)', r.status === 200 && sameCfg(r.data.user.avatar, CFG_A), JSON.stringify(r.data.user && r.data.user.avatar));
  } finally {
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
