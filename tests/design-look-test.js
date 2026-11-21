'use strict';
/* mLT. chat — new look test suite (side rail, logo, brighter color, big videos).
 *
 * The redesign lives in the browser, so this suite verifies what a
 * headless check honestly can: the served HTML/CSS/JS ship the side
 * rail (the bottom tab bar is GONE), the seven sections in rail order
 * with the Chat unread badge on the rail, the content offset that
 * keeps pages clear of the rail, the picked logo in the top bar (in
 * its white chip), larger on the login screen, and as the favicon,
 * the brighter multi-color background wash, and the raised Videos
 * stage — while the full-screen viewer keeps its contain-fit and a
 * basic signup/feed round-trip proves the server contract is intact.
 *
 * Real HTTP against a real running server, copied to a throwaway
 * temp dir (node_modules symlinked) so the shipped data/solkin.db
 * is never touched — same pattern as the other suites.
 *
 * Usage:
 *   node tests/design-look-test.js                # local engine
 *   node tests/design-look-test.js --engine=libsql # Turso facade on a file: DB
 *
 * NOT covered here (needs a human tap-through): rail feel and reach
 * on a real phone, swipe behavior starting near the rail, how the
 * brighter wash and logo chip actually look, video stage feel.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=local').split('=')[1];
const APP_SRC = path.join(__dirname, '..');
const PORT = 3700 + Math.floor(Math.random() * 400);
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-design-look-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: 'file:' + path.join(tmpRoot, 'test.db') }
    : {};
  console.log(`Design-look test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  const child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    // --- served HTML: rail in, bottom bar out, logo installed ---
    const html = await (await fetch(BASE + '/')).text();
    check('no bottom tab bar markup anywhere in the page', !html.includes('bottomnav'));
    const navMatch = html.match(/<nav class="sidenav">([\s\S]*?)<\/nav>/);
    check('side rail nav is served', !!navMatch);
    const nav = navMatch ? navMatch[1] : '';
    const order = [...nav.matchAll(/data-nav="(\w+)"/g)].map((m) => m[1]);
    check('rail holds all 7 sections in order (feed, videos, people, friends, chat, map, profile)',
      JSON.stringify(order) === JSON.stringify(['feed', 'videos', 'people', 'friends', 'chat', 'map', 'profile']), order.join(','));
    check('rail labels ride under their icons', nav.includes('>Feed</button>') && nav.includes('>Profile</button>'));
    check('Chat unread badge lives on the rail Chat button', nav.includes('id="chatBadge"') && nav.includes('class="nav-badge hidden"'));
    check('logo image sits in the top bar inside its white chip',
      html.includes('<div class="logo-chip"><img src="/logo.webp" alt="mLT. chat"></div>'));
    check('logo image shows larger on the login/signup screen',
      html.includes('<div class="auth-logo"><img src="/logo.webp" alt="mLT. chat"></div>'));
    check('favicon points at the logo', html.includes('<link rel="icon" href="/logo.webp" type="image/webp">'));
    check('the logo file itself is served', (await fetch(BASE + '/logo.webp')).status === 200);

    // --- served JS: nav + swipe wired to the rail ---
    const js = await (await fetch(BASE + '/app.js')).text();
    check('no bottom-nav wiring left in the JS', !js.includes('bottomnav'));
    check('showView highlights the active rail button', js.includes("$$('.sidenav button').forEach((b) => b.classList.toggle('on', b.dataset.nav === name))"));
    check('rail buttons switch views on tap', js.includes("$$('.sidenav button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.nav)))"));
    check('swipes that start on the rail never switch pages', js.includes("t.closest('.sidenav')"));
    check('tab order for swiping is unchanged', js.includes("const TAB_ORDER = ['feed', 'videos', 'people', 'friends', 'chat', 'map', 'profile']"));

    // --- served CSS: rail layout, offset, brighter wash, big stage ---
    const css = await (await fetch(BASE + '/style.css')).text();
    check('no bottom-nav styles left', !css.includes('.bottomnav'));
    check('rail is a slim fixed left column, sections spaced evenly down it',
      css.includes('.sidenav{position:fixed; left:0; top:0; bottom:0; width:var(--rail)') && css.includes('justify-content:space-evenly') && css.includes('--rail:64px'));
    check('rail keeps the navy identity with the red edge', css.includes('border-right:3px solid var(--red)'));
    check('active rail section is clearly highlighted', css.includes('.sidenav button.on{color:#fff; background:rgba(255,255,255,.13)'));
    check('main content is offset clear of the rail', css.includes('.wrap{max-width:calc(560px + var(--rail))') && css.includes('calc(10px + var(--rail))'));
    check('top bar content is offset clear of the rail too', css.includes('padding:10px 14px 10px calc(14px + var(--rail))'));
    check('logo chip is a small white rounded card in the top bar', css.includes('.logo-chip{background:#fff; border-radius:11px') && css.includes('.logo-chip img{height:27px'));
    check('login logo is sized large', css.includes('.auth-logo img{width:190px'));
    check('brighter multi-color wash replaces the old blue-to-rose tint',
      css.includes('--wash:linear-gradient(165deg,#a9d6ff') && css.includes('#ffd2e1') && css.includes('body{background:var(--wash)') && !css.includes('#cfdef3 0%,#e3ebf8 34%'));
    check('primary buttons got colorful gradients', css.includes('.btn{display:inline-flex') && css.includes('background:linear-gradient(135deg,var(--navy2),#3a6fd8)') && css.includes('.btn.red{background:linear-gradient(135deg,var(--red),#ff6b81)'));
    check('Videos stage is raised big (70vh, sane min/max) — no more 43vh shrink',
      css.includes('.slide video') && css.includes('height:min(70vh,680px)') && css.includes('min-height:320px') && !css.includes('height:43vh'));
    check('full-screen viewer still fills the screen with contain-fit (never cropped)',
      css.includes('.viewer-stage video') && css.includes('object-fit:contain'));
    check('dark TikTok feed stage is untouched', css.includes('.tk-stage') && css.includes('height:min(84vh,760px)'));

    // --- the unchanged app contract still works end to end ---
    const A = new Client();
    let r = await A.post('/api/signup', { displayName: 'Look A', username: `la_${RUN}`, password: 'test-pass-1' });
    check('signup still works', r.status === 200 && r.data.user, `got ${r.status}`);
    r = await A.get('/api/posts');
    check('feed still loads', r.status === 200 && Array.isArray(r.data.posts));
    r = await A.get('/api/videos');
    check('Videos catalog still loads', r.status === 200 && Array.isArray(r.data.videos) && r.data.videos.length > 0);
  } finally {
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
