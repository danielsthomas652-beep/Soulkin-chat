'use strict';
/* mLT. chat — in-app camera test suite.
 *
 * The camera itself lives in the browser (getUserMedia, a real lens,
 * real permission prompts), so this suite verifies what a headless check
 * honestly can: the served HTML/JS/CSS actually ship the camera screen
 * (Camera buttons in the feed composer AND the Post Editor, viewfinder,
 * Flip and Take picture controls), the JS opens it on the REAR camera
 * (facingMode 'environment'), flips to the front camera ('user'), draws
 * captures to a canvas as a JPEG File named camera-photo.jpg, feeds that
 * file into the SAME editor state the gallery picker uses
 * (setEditorFile(file, 'image')), always stops the camera tracks when
 * leaving, and turns camera failures into friendly messages. The
 * unchanged POST /api/posts contract is then proven end to end with a
 * real JPEG photo post, like the one a capture produces.
 *
 * Real HTTP against a real running server, copied to a throwaway temp
 * dir (node_modules symlinked) so the shipped data/solkin.db is never
 * touched — same pattern as the other suites.
 *
 * Usage:
 *   node tests/camera-test.js                # local engine
 *   node tests/camera-test.js --engine=libsql # Turso facade on a file: DB
 *
 * NOT covered here (needs a human tap-through on a phone): the actual
 * camera hardware, the permission prompt, rear/front lens behavior,
 * and how the viewfinder looks in a hand.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=local').split('=')[1];
const APP_SRC = path.join(__dirname, '..');
const PORT = 4300 + Math.floor(Math.random() * 400);
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-camera-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: `file:${path.join(tmpRoot, 'cloud.db')}`, TURSO_AUTH_TOKEN: 'test-token', SESSION_SECRET: 'test-secret' }
    : {};
  console.log(`Camera test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  let child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    // --- served HTML: camera buttons + the camera screen ---
    const html = await (await fetch(BASE + '/')).text();
    check('feed composer has a Camera button', html.includes('id="btnCamera"') && html.includes('>📸 Camera</button>'));
    check('Post Editor has a Camera button', html.includes('id="edBtnCamera"'));
    check('gallery Photo/Video buttons are still there', html.includes('id="btnPhoto"') && html.includes('id="btnVideoFile"') && html.includes('id="edBtnPhoto"') && html.includes('id="edBtnVideo"'));
    check('HTML serves the full-screen camera view', html.includes('id="cameraView"'));
    check('camera view has a live viewfinder video element', html.includes('id="camVideo"'));
    check('camera view has a Flip button labeled Flip', html.includes('id="camFlip"') && html.includes('<span>Flip</span>'));
    check('camera view has a big Take picture capture button', html.includes('id="camCapture"') && html.includes('Take picture'));
    check('camera view has a close button', html.includes('id="camClose"'));

    // --- served JS: the camera logic ---
    const js = await (await fetch(BASE + '/app.js')).text();
    check('both Camera buttons open the camera screen', js.includes("$('#btnCamera').addEventListener('click', openCamera)") && js.includes("$('#edBtnCamera').addEventListener('click', openCamera)"));
    check('camera uses getUserMedia for the viewfinder', js.includes('navigator.mediaDevices.getUserMedia'));
    check("camera starts on the REAR camera (facingMode 'environment')", js.includes("let camFacing = 'environment'") && js.includes('facingMode: camFacing'));
    check('Flip switches rear <-> front and restarts the stream', js.includes("camFacing === 'environment' ? 'user' : 'environment'") && js.includes("$('#camFlip').addEventListener('click', flipCamera)"));
    check('capture draws the frame to a canvas', js.includes("document.createElement('canvas')") && js.includes('drawImage(v, 0, 0'));
    check("capture produces a JPEG File named camera-photo.jpg", js.includes("new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' })") && js.includes("canvas.toBlob"));
    check("captured photo lands in the editor via the gallery picker's own path", js.includes("setEditorFile(file, 'image')") && js.includes('function capturePhoto'));
    check('leaving the camera always stops its tracks', js.includes('function stopCameraStream') && js.includes('camStream.getTracks().forEach((t) => t.stop())') && js.includes("$('#camClose').addEventListener('click', closeCamera)"));
    check('camera failures become friendly messages (denied / none / busy / unsupported)',
      js.includes('function cameraErrorMessage') && js.includes('NotAllowedError') && js.includes('NotFoundError') && js.includes('NotReadableError') && js.includes('UnsupportedError'));
    check('swipe nav treats the open camera as an overlay', js.includes("'#cameraView'"));

    // --- served CSS: camera screen is styled ---
    const css = await (await fetch(BASE + '/style.css')).text();
    check('CSS styles the camera view + big capture button', css.includes('#cameraView') && css.includes('.capture-btn') && css.includes('.camera-stage video'));

    // --- the unchanged posting contract: a captured-style JPEG photo post works ---
    const A = new Client();
    let r = await A.post('/api/signup', { displayName: 'Camera A', username: `ca_${RUN}`, password: 'test-pass-1' });
    check('signup A succeeds', r.status === 200 && r.data.user, `got ${r.status}`);
    // a real (tiny) JPEG, posted with the exact filename a capture produces
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwH/2Q==', 'base64');
    const fd = new FormData();
    fd.append('text', 'Took this with the in-app camera 📸');
    fd.append('media', new Blob([jpeg], { type: 'image/jpeg' }), 'camera-photo.jpg');
    const cookie = [...A.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const upRes = await fetch(BASE + '/api/posts', { method: 'POST', headers: { Cookie: cookie }, body: fd });
    const upData = await upRes.json().catch(() => ({}));
    check('JPEG photo post succeeds through the editor media path', upRes.status === 200 && upData.post && upData.post.mediaType === 'image', `got ${upRes.status} ${JSON.stringify(upData)}`);
    const camPostId = upData.post && upData.post.id;

    const B = new Client();
    r = await B.post('/api/signup', { displayName: 'Camera B', username: `cb_${RUN}`, password: 'test-pass-1' });
    check('signup B succeeds', r.status === 200 && r.data.user);
    r = await B.get('/api/posts');
    check("B's feed shows A's camera photo post", r.status === 200 && r.data.posts.some((p) => p.id === camPostId), JSON.stringify(r.data).slice(0, 200));
  } finally {
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
