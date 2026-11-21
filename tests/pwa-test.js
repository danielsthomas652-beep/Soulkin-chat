'use strict';
/* mLT. chat — installable app (PWA) test suite.
 *
 * Verifies what a headless check honestly can: the served HTML
 * carries the manifest link, theme color and Apple install metas;
 * the manifest parses with the required fields and icon entries;
 * the three generated icons serve as real PNGs of exactly the right
 * size; the service worker serves, registers from app.js, is
 * network-first for pages/code and never caches /api or /media;
 * and the Profile install button is wired to beforeinstallprompt
 * with a plain-instructions fallback. A signup/profile round-trip
 * proves the app contract is untouched.
 *
 * Real HTTP against a real running server, copied to a throwaway
 * temp dir (node_modules symlinked) so the shipped data/solkin.db
 * is never touched — same pattern as the other suites.
 *
 * Usage:
 *   node tests/pwa-test.js                # local engine
 *   node tests/pwa-test.js --engine=libsql # Turso facade on a file: DB
 *
 * NOT covered here (needs Tom's phone): the real Android install
 * prompt, the iOS Add-to-Home-Screen flow, and launching from the
 * home-screen icon into the standalone app.
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

function pngSize(buf) {
  // PNG magic: 89 50 4E 47 0D 0A 1A 0A; IHDR width/height are
  // big-endian uint32 at byte offsets 16 and 20.
  const magicOk = buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!magicOk) return { magicOk, w: 0, h: 0 };
  return { magicOk, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-pwa-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: 'file:' + path.join(tmpRoot, 'test.db') }
    : {};
  console.log(`PWA test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  const child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    // --- served HTML: install wiring in the head ---
    const html = await (await fetch(BASE + '/')).text();
    check('manifest link is in the head', html.includes('<link rel="manifest" href="/manifest.webmanifest">'));
    check('theme-color meta matches the navy top bar (#16305e)', html.includes('<meta name="theme-color" content="#16305e">'));
    check('apple touch icon is linked', html.includes('<link rel="apple-touch-icon" href="/apple-touch-icon.png">'));
    check('mobile-web-app-capable meta present', html.includes('<meta name="mobile-web-app-capable" content="yes">'));
    check('apple-mobile-web-app-capable meta present', html.includes('<meta name="apple-mobile-web-app-capable" content="yes">'));
    check('apple-mobile-web-app-title is mLT. chat', html.includes('<meta name="apple-mobile-web-app-title" content="mLT. chat">'));

    // --- Profile: install button + the view still renders ---
    check('Profile view still served', html.includes('<section id="view-profile"') && html.includes('id="profName"'));
    check('install button sits in the Profile card with its label',
      html.includes('id="btnInstall"') && html.includes('📲 Add mLT. chat to my home screen'));
    check('install hint line exists next to the button', html.includes('id="installHint"'));

    // --- the manifest itself ---
    const mRes = await fetch(BASE + '/manifest.webmanifest');
    check('manifest serves 200', mRes.status === 200, `got ${mRes.status}`);
    check('manifest serves with a manifest/json content type',
      /manifest\+json|application\/json/.test(mRes.headers.get('content-type') || ''), mRes.headers.get('content-type'));
    let manifest = null;
    try { manifest = JSON.parse(await mRes.text()); } catch (e) { /* stays null */ }
    check('manifest parses as JSON', !!manifest);
    if (manifest) {
      check('manifest name + short_name are mLT. chat', manifest.name === 'mLT. chat' && manifest.short_name === 'mLT. chat');
      check('manifest start_url + scope are /', manifest.start_url === '/' && manifest.scope === '/');
      check('manifest display is standalone', manifest.display === 'standalone');
      check('manifest colors: white background, navy theme', manifest.background_color === '#ffffff' && manifest.theme_color === '#16305e');
      const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
      const i192 = icons.find((i) => i.sizes === '192x192');
      const i512 = icons.find((i) => i.sizes === '512x512');
      check('manifest registers a 192 PNG icon', !!i192 && i192.type === 'image/png' && i192.src === '/icon-192.png');
      check('manifest registers a 512 PNG icon', !!i512 && i512.type === 'image/png' && i512.src === '/icon-512.png');
    }

    // --- the icon files: real PNGs, exact dimensions ---
    for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
      check(`${file} exists in public/`, fs.existsSync(path.join(APP_SRC, 'public', file)));
      const res = await fetch(BASE + '/' + file);
      const buf = Buffer.from(await res.arrayBuffer());
      const info = pngSize(buf);
      check(`${file} serves as a PNG with magic bytes`, res.status === 200 && info.magicOk, `status ${res.status}`);
      check(`${file} is exactly ${size}x${size}`, info.w === size && info.h === size, `got ${info.w}x${info.h}`);
    }

    // --- the service worker ---
    const swRes = await fetch(BASE + '/sw.js');
    const sw = await swRes.text();
    check('service worker serves 200 as JavaScript',
      swRes.status === 200 && /javascript/.test(swRes.headers.get('content-type') || ''), swRes.headers.get('content-type'));
    check('SW carries a bumpable VERSION constant', /const VERSION = 'v\d+'/.test(sw));
    check('SW precaches only the logo + icons cache-first',
      sw.includes("const STATIC_FILES = ['/logo.webp', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']") && sw.includes('caches.match(request)'));
    check('SW never caches /api or /media',
      sw.includes("url.pathname.startsWith('/api/')") && sw.includes("url.pathname.startsWith('/media/')"));
    check('SW is network-first for pages/scripts/styles',
      sw.includes("request.mode === 'navigate'") && sw.includes("['document', 'script', 'style']") && sw.includes('fetch(request)'));
    check('SW retires old caches on activate', sw.includes("addEventListener('activate'") && sw.includes('caches.delete(k)'));

    // --- served JS: registration + install prompt wiring ---
    const js = await (await fetch(BASE + '/app.js')).text();
    check('app.js registers the service worker', js.includes("navigator.serviceWorker.register('/sw.js')"));
    check('SW registration is guarded to https/localhost', js.includes("location.protocol === 'https:'") && js.includes("'serviceWorker' in navigator"));
    check('beforeinstallprompt is captured', js.includes("window.addEventListener('beforeinstallprompt'") && js.includes('installPromptEvent = e'));
    check('install button triggers the captured prompt', js.includes("$('#btnInstall').addEventListener('click'") && js.includes('installPromptEvent.prompt()'));
    check('fallback instructions cover Android and iPhone',
      js.includes("then 'Add to Home screen'") && js.includes("tap Share, then 'Add to Home Screen'"));
    check('button hides when already running installed', js.includes("display-mode: standalone") && js.includes('runningInstalled()'));

    // --- the unchanged app contract still works end to end ---
    const A = new Client();
    let r = await A.post('/api/signup', { displayName: 'PWA A', username: `pa_${RUN}`, password: 'test-pass-1' });
    check('signup still works', r.status === 200 && r.data.user, `got ${r.status}`);
    r = await A.get('/api/me');
    check('Profile data still loads (/api/me)', r.status === 200 && r.data.user && r.data.user.username === `pa_${RUN}`);
    r = await A.get('/api/posts');
    check('feed still loads', r.status === 200 && Array.isArray(r.data.posts));
  } finally {
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
