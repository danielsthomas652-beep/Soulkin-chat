'use strict';
/* mLT. chat — Friend Map (opt-in location sharing) end-to-end test suite.
 *
 * Real HTTP clients against a real running server, in the style of
 * tests/phone-dial-test.js. The app is copied to a throwaway temp dir
 * (node_modules symlinked) so the shipped data/solkin.db is never
 * touched. The temp database is PRE-CREATED with the phone-era users
 * schema (phone present; share_location / lat / lng / location_at
 * absent) so every run also proves the startup migration adds them.
 *
 * Usage:
 *   node tests/map-test.js                # local engine (better-sqlite3 / node:sqlite)
 *   node tests/map-test.js --engine=libsql # Turso facade via @libsql/client on a file: DB
 *
 * The rules under test (owner: "You gotta be able to see a map" of your
 * friends' locations):
 *   * Sharing is opt-in, OFF by default (PATCH /api/me {shareLocation}).
 *     Turning it off wipes the stored fix server-side, immediately.
 *   * POST /api/location stores a fix only while the caller's sharing
 *     is on (else 403); coordinates are validated (400 when off-map,
 *     missing, or not numbers).
 *   * GET /api/map returns only accepted friends who are sharing and
 *     have a fix, through the visibleLocation gate:
 *       - a Protected user's location is NEVER served — write lock
 *         (their POST /api/location is refused, 403) AND read lock
 *         (even coordinates forced into the DB by hand never appear);
 *       - pending / non-friends see nothing;
 *       - cross-band pairs need friendships.known_confirmed = 1 before
 *         the adult's location is shown to the Protected friend.
 *   * Unfriending removes visibility; sharing + fix survive a restart.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=local').split('=')[1];
const APP_SRC = path.join(__dirname, '..');
const PORT = 3950 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Math.random().toString(36).slice(2, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Distinct coordinates per user, so payloads can be scanned for leaks.
const GEO = {
  A1: { lat: 43.123456, lng: -77.654321 },
  A3: { lat: 43.222222, lng: -77.222222 },
  E: { lat: 43.333333, lng: -77.333333 },
  C: { lat: 43.444444, lng: -77.444444 },
  P1F: { lat: 44.555666, lng: -76.555666 }, // forced into the DB by hand for P1
};
const latStr = (g) => String(g.lat);

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
const leaks = (data, s) => JSON.stringify(data || {}).includes(s);

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
async function shareAndPost(u, geo) {
  const on = await u.client.patch('/api/me', { shareLocation: true });
  if (on.status !== 200 || !on.data.user.shareLocation) throw new Error('share-on failed: ' + JSON.stringify(on));
  const p = await u.client.post('/api/location', geo);
  if (p.status !== 200) throw new Error('location post failed: ' + JSON.stringify(p));
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-map-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: `file:${path.join(tmpRoot, 'cloud.db')}`, TURSO_AUTH_TOKEN: 'test-token', SESSION_SECRET: 'test-secret' }
    : {};
  const dbFile = ENGINE === 'libsql' ? path.join(tmpRoot, 'cloud.db') : path.join(appDir, 'data', 'solkin.db');
  console.log(`Friend Map test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  // Pre-create the DB with the PHONE-ERA users schema (phone present,
  // location columns absent): the startup migration must add them.
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  const preCols = pre.prepare("SELECT name FROM pragma_table_info('users')").all().map((c) => c.name);
  pre.close();
  check('pre-created DB really is the phone-era schema (phone yes, location columns no)',
    preCols.includes('phone') && !['share_location', 'lat', 'lng', 'location_at'].some((c) => preCols.includes(c)), JSON.stringify(preCols));

  let child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    // --- served UI ships the map pieces ---
    const html = await (await fetch(BASE + '/')).text();
    check('served HTML has the Map nav button, view, map box and empty state',
      html.includes('data-nav="map"') && html.includes('id="view-map"') && html.includes('id="mapEl"') && html.includes('id="mapEmpty"')
      && html.includes('None of your friends are sharing their location right now'));
    check('served HTML loads Leaflet from the CDN and has the sharing toggles',
      html.includes('leaflet@1.9.4') && html.includes('id="btnShareLoc"') && html.includes('id="mapToggleShare"'));
    const js = await (await fetch(BASE + '/app.js')).text();
    check('served JS: tab order includes map between chat and profile',
      js.includes("const TAB_ORDER = ['feed', 'videos', 'people', 'friends', 'chat', 'map', 'profile']"));
    check('served JS wires the map (Leaflet + OSM tiles, /api/map, geolocation, shareLocation PATCH)',
      js.includes('L.map(') && js.includes('tile.openstreetmap.org') && js.includes("api('/api/map')")
      && js.includes('navigator.geolocation') && js.includes('shareLocation'));
    const css = await (await fetch(BASE + '/style.css')).text();
    check('served CSS styles the map box', css.includes('#mapEl'));

    const A1 = await signup('Adult One', { username: `ma1_${RUN}` });
    const A2 = await signup('Adult Two', { username: `ma2_${RUN}` });
    const S = await signup('Stranger', { username: `ms_${RUN}` });
    const A3 = await signup('Adult Three', { username: `ma3_${RUN}` });
    const P1 = await signup('Protected One', { username: `mp1_${RUN}`, under18: true });
    const P2 = await signup('Protected Two', { username: `mp2_${RUN}`, under18: true });
    const E = await signup('Adult E', { username: `me_${RUN}` });
    const Q = await signup('Protected Q', { username: `mq_${RUN}`, under18: true });
    const C = await signup('Adult C', { username: `mc_${RUN}` });
    const R = await signup('Protected R', { username: `mr_${RUN}`, under18: true });
    const everyone = [A1, A2, S, A3, P1, P2, E, Q, C, R];
    check('signups succeed (on the migrated DB)', everyone.every((x) => x.status === 200 && x.user), JSON.stringify(everyone.map((x) => x.status)));

    // --- auth + defaults ---
    const anon = new Client();
    let r = await anon.get('/api/map');
    check('anonymous GET /api/map refused (401)', r.status === 401, `got ${r.status}`);
    r = await anon.post('/api/location', GEO.A1);
    check('anonymous POST /api/location refused (401)', r.status === 401, `got ${r.status}`);
    r = await A1.client.get('/api/me');
    check('sharing is OFF by default (/api/me shareLocation false)', r.status === 200 && r.data.user.shareLocation === false, JSON.stringify(r.data.user));
    r = await A1.client.post('/api/location', GEO.A1);
    check('POST /api/location while sharing is off refused (403, plain language)', r.status === 403 && /sharing is off/i.test(r.data.error || ''), `got ${r.status} ${JSON.stringify(r.data)}`);

    // --- friends, but nobody sharing yet: the map is empty ---
    await befriend(A1, A2);
    r = await A2.client.get('/api/map');
    check('GET /api/map shape is {friends: []} when nobody shares', r.status === 200 && Array.isArray(r.data.friends) && r.data.friends.length === 0, `got ${r.status} ${JSON.stringify(r.data)}`);

    // --- the toggle ---
    r = await A1.client.patch('/api/me', { shareLocation: 'yes' });
    check('non-boolean shareLocation refused (400)', r.status === 400, `got ${r.status}`);
    r = await A1.client.patch('/api/me', { shareLocation: true });
    check('PATCH shareLocation true turns sharing on', r.status === 200 && r.data.user.shareLocation === true, `got ${r.status} ${JSON.stringify(r.data.user)}`);
    r = await A1.client.patch('/api/me', { displayName: 'Adult One' });
    check('name-only PATCH leaves sharing on', r.status === 200 && r.data.user.shareLocation === true, `got ${r.status} ${JSON.stringify(r.data.user)}`);

    // --- coordinate validation ---
    r = await A1.client.post('/api/location', { lat: 91, lng: 0 });
    check('latitude beyond the pole refused (400)', r.status === 400, `got ${r.status}`);
    r = await A1.client.post('/api/location', { lat: 0, lng: -181 });
    check('longitude beyond the antimeridian refused (400)', r.status === 400, `got ${r.status}`);
    r = await A1.client.post('/api/location', { lat: 'abc', lng: 0 });
    check('non-numeric latitude refused (400)', r.status === 400, `got ${r.status}`);
    r = await A1.client.post('/api/location', { lat: GEO.A1.lat });
    check('missing longitude refused (400)', r.status === 400, `got ${r.status}`);
    r = await A1.client.post('/api/location', { lat: null, lng: null });
    check('null coordinates refused (400)', r.status === 400, `got ${r.status}`);
    r = await A1.client.post('/api/location', GEO.A1);
    check('valid fix stored (200, ok)', r.status === 200 && r.data.ok === true, `got ${r.status} ${JSON.stringify(r.data)}`);

    // --- an accepted friend sees the pin ---
    r = await A2.client.get('/api/map');
    const pinA1 = (r.data.friends || []).find((f) => f.user.id === A1.user.id);
    check('accepted friend sees the sharer on the map', !!pinA1, JSON.stringify(r.data));
    check('pin carries the exact coordinates', !!pinA1 && pinA1.lat === GEO.A1.lat && pinA1.lng === GEO.A1.lng, JSON.stringify(pinA1));
    check('pin carries updatedAt and the plain public user shape',
      !!pinA1 && typeof pinA1.updatedAt === 'string' && pinA1.updatedAt.length > 0 && pinA1.user.username === A1.user.username && pinA1.user.shareLocation === undefined, JSON.stringify(pinA1));
    r = await A1.client.get('/api/map');
    check('the sharer does not see themself (A2 is not sharing)', r.status === 200 && r.data.friends.length === 0, JSON.stringify(r.data));

    // --- strangers see nothing ---
    r = await S.client.get('/api/map');
    check('stranger GET /api/map is empty, no coordinate leak', r.status === 200 && r.data.friends.length === 0 && !leaks(r.data, latStr(GEO.A1)), JSON.stringify(r.data));

    // --- pending relationships see nothing, either way ---
    await shareAndPost(A3, GEO.A3);
    r = await A3.client.post('/api/friends/request', { userId: A1.user.id });
    check('A3 → A1 request sent (pending)', r.status === 200, `got ${r.status}`);
    r = await A3.client.get('/api/map');
    check('pending_out: A3 sees nothing of A1', r.status === 200 && r.data.friends.length === 0 && !leaks(r.data, latStr(GEO.A1)), JSON.stringify(r.data));
    r = await A1.client.get('/api/map');
    check('pending_in: A1 does not see the sharing A3', r.status === 200 && !(r.data.friends || []).some((f) => f.user.id === A3.user.id) && !leaks(r.data, latStr(GEO.A3)), JSON.stringify(r.data));

    // --- Protected: the write lock ---
    r = await P1.client.patch('/api/me', { shareLocation: true });
    check('Protected user may flip the toggle (it changes nothing by itself)', r.status === 200 && r.data.user.shareLocation === true, `got ${r.status} ${JSON.stringify(r.data.user)}`);
    r = await P1.client.post('/api/location', { lat: 43.9, lng: -77.9 });
    check('Protected POST /api/location refused (403, plain language)', r.status === 403 && /Protected/i.test(r.data.error || ''), `got ${r.status} ${JSON.stringify(r.data)}`);
    await befriend(P1, P2);
    r = await P2.client.get('/api/map');
    check('Protected friend map is empty (nothing was ever stored)', r.status === 200 && r.data.friends.length === 0, JSON.stringify(r.data));

    // --- Protected: the read lock (coords forced into the DB by hand) ---
    const raw1 = new Database(dbFile);
    try { raw1.prepare("UPDATE users SET share_location = 1, lat = ?, lng = ?, location_at = datetime('now') WHERE id = ?").run(GEO.P1F.lat, GEO.P1F.lng, P1.user.id); }
    finally { raw1.close(); }
    r = await P2.client.get('/api/map');
    check('forced Protected coords NEVER served to a friend (map)', r.status === 200 && r.data.friends.length === 0 && !leaks(r.data, latStr(GEO.P1F)), JSON.stringify(r.data));
    r = await P2.client.get('/api/people');
    check('forced Protected coords do not leak via People', !leaks(r.data, latStr(GEO.P1F)), JSON.stringify(r.data).slice(0, 200));
    r = await P2.client.get('/api/friends');
    check('forced Protected coords do not leak via Friends', !leaks(r.data, latStr(GEO.P1F)), JSON.stringify(r.data).slice(0, 200));

    // --- cross-band UNCONFIRMED (forced row): nothing either way ---
    await shareAndPost(E, GEO.E);
    const raw2 = new Database(dbFile);
    try { raw2.prepare("INSERT INTO friendships (requester_id, addressee_id, status, known_confirmed) VALUES (?, ?, 'accepted', 0)").run(E.user.id, Q.user.id); }
    finally { raw2.close(); }
    r = await Q.client.get('/api/map');
    check('unconfirmed cross-band: Protected friend sees NO adult location', r.status === 200 && r.data.friends.length === 0 && !leaks(r.data, latStr(GEO.E)), JSON.stringify(r.data));
    r = await E.client.get('/api/map');
    check('unconfirmed cross-band: adult sees nothing of the Protected side', r.status === 200 && !(r.data.friends || []).some((f) => f.user.id === Q.user.id), JSON.stringify(r.data));

    // --- cross-band CONFIRMED: Protected viewer sees the adult's pin ---
    await shareAndPost(C, GEO.C);
    await befriend(R, C, { knowsPerson: true }); // R attests; C accepts normally
    r = await R.client.get('/api/map');
    const pinC = (r.data.friends || []).find((f) => f.user.id === C.user.id);
    check('confirmed cross-band: Protected friend sees the adult pin', !!pinC && pinC.lat === GEO.C.lat && pinC.lng === GEO.C.lng, JSON.stringify(r.data));
    r = await C.client.get('/api/map');
    check('confirmed cross-band: adult sees nothing back (Protected never appears)', r.status === 200 && !(r.data.friends || []).some((f) => f.user.id === R.user.id) && !leaks(r.data, latStr(GEO.P1F)), JSON.stringify(r.data));

    // --- turning sharing OFF wipes the fix, immediately ---
    r = await A1.client.patch('/api/me', { shareLocation: false });
    check('PATCH shareLocation false turns sharing off', r.status === 200 && r.data.user.shareLocation === false, `got ${r.status} ${JSON.stringify(r.data.user)}`);
    r = await A2.client.get('/api/map');
    check('friend map loses the pin the moment sharing goes off', r.status === 200 && !(r.data.friends || []).some((f) => f.user.id === A1.user.id), JSON.stringify(r.data));
    r = await A1.client.post('/api/location', GEO.A1);
    check('POST /api/location refused again once off (403)', r.status === 403, `got ${r.status}`);
    // The stored row itself must be wiped, not just hidden:
    const raw3 = new Database(dbFile);
    let wiped = null;
    try { wiped = raw3.prepare('SELECT share_location, lat, lng, location_at FROM users WHERE id = ?').get(A1.user.id); }
    finally { raw3.close(); }
    check('stored fix is wiped in the DB (share 0, coords + timestamp NULL)',
      !!wiped && wiped.share_location === 0 && wiped.lat === null && wiped.lng === null && wiped.location_at === null, JSON.stringify(wiped));

    // --- sharing + fix survive a restart ---
    await shareAndPost(A1, GEO.A1);
    console.log('Restarting server…');
    await stopServer(child);
    child = startServer(appDir, env);
    await waitReady(child);
    const A2b = new Client();
    const lr = await A2b.post('/api/login', { username: `ma2_${RUN}`, password: 'test-pass-1' });
    check('login after restart works', lr.status === 200, `got ${lr.status}`);
    r = await A2b.get('/api/map');
    const pinAfter = (r.data.friends || []).find((f) => f.user.id === A1.user.id);
    check('friend pin survived restart with its coordinates', !!pinAfter && pinAfter.lat === GEO.A1.lat && pinAfter.lng === GEO.A1.lng, JSON.stringify(r.data));
    const A1b = new Client();
    await A1b.post('/api/login', { username: `ma1_${RUN}`, password: 'test-pass-1' });
    r = await A1b.get('/api/me');
    check('own sharing switch survived restart', r.data.user.shareLocation === true, JSON.stringify(r.data.user));

    // --- unfriending removes visibility ---
    r = await A2b.post('/api/friends/remove', { userId: A1.user.id });
    check('A2 unfriends A1', r.status === 200, `got ${r.status}`);
    r = await A2b.get('/api/map');
    check('ex-friend no longer sees the pin', r.status === 200 && !(r.data.friends || []).some((f) => f.user.id === A1.user.id) && !leaks(r.data, latStr(GEO.A1)), JSON.stringify(r.data));
  } finally {
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
