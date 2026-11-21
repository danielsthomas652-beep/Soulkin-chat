'use strict';
/* mLT. chat — post editor + swipe navigation test suite.
 *
 * The editor and the swipe gestures live in the browser, so this suite
 * verifies what a headless check honestly can: the served HTML/JS/CSS
 * actually ship the editor (overlay, caption, media buttons, Add music
 * wired to the existing song picker, Post/Cancel), the feed composer no
 * longer carries a direct-post path, the swipe-between-pages handler is
 * present with its Videos-view guard, and the unchanged POST /api/posts
 * contract still works end to end (signup → post → second user sees it,
 * including a photo upload with a song attached to a video-style post).
 *
 * Real HTTP against a real running server, copied to a throwaway temp
 * dir (node_modules symlinked) so the shipped data/solkin.db is never
 * touched — same pattern as the other suites.
 *
 * Usage:
 *   node tests/editor-test.js                # local engine
 *   node tests/editor-test.js --engine=libsql # Turso facade on a file: DB
 *
 * NOT covered here (needs a human tap-through): the editor's feel, the
 * file-picker flow on a real phone, and the actual swipe gestures.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=local').split('=')[1];
const APP_SRC = path.join(__dirname, '..');
const PORT = 3400 + Math.floor(Math.random() * 400);
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-editor-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: `file:${path.join(tmpRoot, 'cloud.db')}`, TURSO_AUTH_TOKEN: 'test-token', SESSION_SECRET: 'test-secret' }
    : {};
  console.log(`Post editor test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  let child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    // --- served HTML: the editor is there, the direct-post path is gone ---
    const html = await (await fetch(BASE + '/')).text();
    check('HTML serves the Post Editor overlay', html.includes('id="postEditor"'));
    check('editor has a caption field', html.includes('id="editorText"'));
    check('editor has a media preview area', html.includes('id="editorMedia"'));
    check('editor has Add/Change photo + video buttons', html.includes('id="edBtnPhoto"') && html.includes('id="edBtnVideo"'));
    check('editor has a Remove media button', html.includes('id="edBtnRemoveMedia"'));
    check('editor has an Add music button + song tag spot', html.includes('id="edBtnMusic"') && html.includes('id="editorSong"'));
    check('editor has Post and Cancel buttons', html.includes('id="editorPost"') && html.includes('id="editorCancel"'));
    check('feed composer keeps its entry points (text box, Photo, Video, Music)',
      html.includes('id="composerText"') && html.includes('id="btnPhoto"') && html.includes('id="btnVideoFile"') && html.includes('id="btnMusic"'));
    check('old direct-post button is GONE from the composer', !html.includes('id="btnPost"'));
    check('old in-composer media preview / song tag are GONE', !html.includes('id="mediaPreview"') && !html.includes('id="composerSong"'));

    // --- served JS: editor logic + swipe nav, no direct posting ---
    const js = await (await fetch(BASE + '/app.js')).text();
    check('JS opens the editor from the composer text box', js.includes("$('#composerText').addEventListener('click'"));
    check('JS defines the editor open/discard flow', js.includes('function openEditor') && js.includes('function discardEditor'));
    check('editor Add music opens the existing song picker for the editor', js.includes("openMusicPicker({ type: 'editor' })"));
    check('song picker attaches the chosen song to the editor draft', js.includes("musicTarget.type === 'editor'") && js.includes('editorSong = s'));
    check('editor Post publishes through the existing /api/posts flow', js.includes("$('#editorPost').addEventListener('click'") && js.includes("fetch('/api/posts'") && js.includes("fd.append('songId'"));
    check('editor Cancel is wired to discard the draft', js.includes("$('#editorCancel').addEventListener('click', discardEditor)"));
    check('no direct-post handler remains in JS', !js.includes("$('#btnPost')") && !js.includes("type: 'composer'") && !js.includes('pendingFile'));
    check('swipe nav: tab order follows the bottom nav', js.includes("const TAB_ORDER = ['feed', 'videos', 'people', 'friends', 'profile']"));
    check('swipe nav: touch handler with a ~60px mostly-horizontal threshold', js.includes("addEventListener('touchend'") && js.includes('Math.abs(dx) < 60'));
    check('swipe nav: Videos view is left to its pager', js.includes("currentView === 'videos'"));
    check('swipe nav: overlays and form fields are not hijacked', js.includes('anyOverlayOpen') && js.includes('insideHScroller'));

    // --- served CSS: editor is styled in the app theme ---
    const css = await (await fetch(BASE + '/style.css')).text();
    check('CSS styles the editor overlay + media area', css.includes('#postEditor') && css.includes('.editor-media'));

    // --- the unchanged posting contract still works end to end ---
    const A = new Client();
    let r = await A.post('/api/signup', { displayName: 'Editor A', username: `ea_${RUN}`, password: 'test-pass-1' });
    check('signup A succeeds', r.status === 200 && r.data.user, `got ${r.status}`);
    r = await A.post('/api/posts', { text: 'Posted through the editor flow 🎉', songId: null });
    check('text post via POST /api/posts succeeds (the editor JSON path)', r.status === 200 && r.data.post && r.data.post.text.includes('editor flow'), `got ${r.status} ${JSON.stringify(r.data)}`);
    const postId = r.data.post && r.data.post.id;

    const songs = await A.get('/api/songs');
    check('song catalog serves (the picker the editor reuses)', songs.status === 200 && Array.isArray(songs.data.songs) && songs.data.songs.length > 0);
    const songId = songs.data.songs[0].id;

    // photo upload through the multipart path the editor uses, with a song id attached
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082', 'hex');
    const fd = new FormData();
    fd.append('text', 'Editor photo post 📷');
    fd.append('media', new Blob([png], { type: 'image/png' }), 'dot.png');
    fd.append('songId', songId);
    const cookie = [...A.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const upRes = await fetch(BASE + '/api/posts', { method: 'POST', headers: { Cookie: cookie }, body: fd });
    const upData = await upRes.json().catch(() => ({}));
    check('photo post via multipart succeeds (the editor media path)', upRes.status === 200 && upData.post && upData.post.mediaType === 'image', `got ${upRes.status} ${JSON.stringify(upData)}`);

    const B = new Client();
    r = await B.post('/api/signup', { displayName: 'Editor B', username: `eb_${RUN}`, password: 'test-pass-1' });
    check('signup B succeeds', r.status === 200 && r.data.user);
    r = await B.get('/api/posts');
    check("B's feed shows A's posts (shared feed, unchanged)", r.status === 200 && r.data.posts.some((p) => p.id === postId) && r.data.posts.some((p) => p.text === 'Editor photo post 📷'), JSON.stringify(r.data).slice(0, 200));
  } finally {
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
