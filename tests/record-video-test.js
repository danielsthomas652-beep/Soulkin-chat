'use strict';
/* mLT. chat — TikTok-style video recording test suite.
 *
 * The recorder itself lives in the browser (MediaRecorder, a real
 * camera + microphone, real permission prompts), so — like the camera
 * suite — this suite verifies what a headless check honestly can:
 *
 *   * The served HTML/JS/CSS actually ship the recorder: the camera's
 *     Photo / Video toggle (shown only for the Post Editor target),
 *     Record / Stop buttons, the on-screen timer, and the preview
 *     screen (Retake / Use video). The JS wires MediaRecorder with the
 *     mp4 -> webm isTypeSupported preference, the small-file bitrates
 *     (videoBitsPerSecond 1200000, audioBitsPerSecond 64000), the
 *     60-second cap (CAM_MAX_SECONDS) with auto-stop, audio requested
 *     only in video mode, and Use video handing a recorded-video.mp4 /
 *     .webm File to the SAME setEditorFile(file, 'video') path gallery
 *     picks use. The photo path (capturePhoto, camera-photo.jpg) is
 *     proven untouched.
 *
 *   * The server half that makes recording work on the LIVE app: in
 *     cloud mode (libsql facade) post videos are now stored as
 *     media_blobs and served at /media/:id — a small webm AND a small
 *     mp4 come back byte-identical with the right mime; HTTP Range
 *     requests return 206 with the exact byte slice (start-end,
 *     open-ended, and suffix forms) while a plain GET stays a full
 *     200; a video over the 20 MB cloud cap is refused 413 and the
 *     photo cap is unchanged (over 5 MB -> 413, small photo fine).
 *     On the local engine a video post still stores under /uploads/
 *     and serves back byte-identical, exactly as before.
 *
 * Sample "videos" are tiny fixtures with the right magic bytes and a
 * patterned body — the server stores/serves bytes opaquely, so they
 * need not be playable; the pattern makes Range slices verifiable.
 *
 * Real HTTP against a real running server, copied to a throwaway temp
 * dir (node_modules symlinked) so the shipped data/solkin.db is never
 * touched — same pattern as the other suites.
 *
 * Usage:
 *   node tests/record-video-test.js                 # local engine
 *   node tests/record-video-test.js --engine=libsql # Turso facade on a file: DB
 *
 * NOT covered here (needs a human tap-through on a phone): real
 * MediaRecorder behavior — above all iPhone Safari's mp4 support —
 * microphone permission prompts, and how a take looks/sounds.
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
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
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
    this.absorb(res);
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { status: res.status, data };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b || {}); }
  async postForm(p, fd) {
    const headers = {};
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method: 'POST', headers, body: fd });
    this.absorb(res);
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { status: res.status, data };
  }
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

// --- tiny "video" fixtures: real magic bytes + a patterned body, so a
// Range slice can be checked byte for byte. Not playable — the server
// stores and serves bytes opaquely, which is what is under test. ---
function patterned(len, seed) {
  const b = Buffer.alloc(len);
  for (let i = 0; i < len; i++) b[i] = (i * 7 + seed) % 251;
  return b;
}
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x88, 0x77, 0x65, 0x62, 0x6d]), patterned(4096, 3)]);
const MP4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), patterned(3072, 11)]);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082', 'hex');

function mediaForm(bytes, type, filename, text) {
  const fd = new FormData();
  if (text) fd.append('text', text);
  fd.append('media', new Blob([bytes], { type }), filename);
  return fd;
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-record-video-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: `file:${path.join(tmpRoot, 'cloud.db')}`, TURSO_AUTH_TOKEN: 'test-token', SESSION_SECRET: 'test-secret' }
    : {};
  console.log(`Record-video test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  const child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    // --- served HTML: the recorder UI ---
    const html = await (await fetch(BASE + '/')).text();
    check('camera has a Photo / Video mode toggle', html.includes('id="camModeRow"') && html.includes('id="camModePhoto"') && html.includes('id="camModeVideo"'));
    check('camera has Record and Stop buttons for video mode', html.includes('id="camRecord"') && html.includes('id="camStop"') && html.includes('id="camVideoControls"'));
    check('camera has an on-screen recording timer', html.includes('id="camTimer"'));
    check('camera has a preview screen with Retake and Use video', html.includes('id="camPreview"') && html.includes('id="camPreviewVideo"') && html.includes('id="camRetake"') && html.includes('id="camUseVideo"'));
    check('photo controls are still there (Take picture)', html.includes('id="camPhotoControls"') && html.includes('id="camCapture"') && html.includes('Take picture'));

    // --- served JS: the recorder wiring ---
    const js = await (await fetch(BASE + '/app.js')).text();
    check('toggle shows only for the editor target (thread/Flash stay photo-only)',
      js.includes("$('#camModeRow').classList.toggle('hidden', camTarget !== 'editor')") && js.includes("camMode = 'photo'"));
    check('mode toggle buttons are wired', js.includes("$('#camModePhoto').addEventListener('click', () => setCamMode('photo'))") && js.includes("$('#camModeVideo').addEventListener('click', () => setCamMode('video'))"));
    check('video mode asks for the microphone, photo mode does not', js.includes("audio: camMode === 'video'"));
    check('recording uses MediaRecorder on the camera stream', js.includes('new MediaRecorder(camStream, opts)') && js.includes('function startRecording'));
    check('recorder mime preference is mp4 first, webm fallback (isTypeSupported)', js.includes("['video/mp4', 'video/webm']") && js.includes('MediaRecorder.isTypeSupported') && js.includes('function pickRecorderMime'));
    check('recorder bitrates keep files small (1.2 Mbps video, 64 kbps audio)', js.includes('videoBitsPerSecond: 1200000') && js.includes('audioBitsPerSecond: 64000'));
    check('60-second cap with timer + auto-stop', js.includes('const CAM_MAX_SECONDS = 60') && js.includes('camRecTimer = setInterval') && js.includes('>= CAM_MAX_SECONDS') && js.includes('function updateCamTimer'));
    check('Record / Stop buttons are wired', js.includes("$('#camRecord').addEventListener('click', startRecording)") && js.includes("$('#camStop').addEventListener('click', stopRecording)"));
    check('preview Retake discards, Use video keeps', js.includes("$('#camRetake').addEventListener('click', hideCamPreview)") && js.includes("$('#camUseVideo').addEventListener('click', useRecordedVideo)"));
    check('Use video builds recorded-video.mp4 / .webm and feeds the editor video path',
      js.includes("isMp4 ? 'recorded-video.mp4' : 'recorded-video.webm'") && js.includes('function useRecordedVideo') && js.includes("setEditorFile(file, 'video')"));
    check('closing the camera mid-recording discards the take', js.includes('function cancelRecording') && js.includes('cancelRecording(); // closing mid-recording discards the take'));
    check('unsupported recorders become a plain-language toast', js.includes("typeof MediaRecorder === 'undefined'") && js.includes('record video here. Try Chrome or Safari'));
    check('photo path untouched (capturePhoto + camera-photo.jpg)', js.includes('function capturePhoto') && js.includes("new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' })"));

    // --- served CSS ---
    const css = await (await fetch(BASE + '/style.css')).text();
    check('CSS styles the toggle, record/stop buttons, timer and preview', css.includes('.cam-mode-btn') && css.includes('.record-btn') && css.includes('.stop-btn') && css.includes('.camera-timer') && css.includes('.camera-preview'));

    // --- API: posting videos, the way the recorder + editor do it ---
    const A = new Client();
    let r = await A.post('/api/signup', { displayName: 'Recorder A', username: `ra_${RUN}`, password: 'test-pass-1' });
    check('signup A succeeds', r.status === 200 && r.data.user, `got ${r.status}`);

    r = await A.postForm('/api/posts', mediaForm(WEBM, 'video/webm', 'recorded-video.webm', 'My first recorded clip 🎬'));
    check('webm video post succeeds (200, mediaType video)', r.status === 200 && r.data.post && r.data.post.mediaType === 'video', `got ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    const webmUrl = r.data.post && r.data.post.mediaUrl;
    if (ENGINE === 'libsql') check('cloud mode stores the video as a /media/:id blob', typeof webmUrl === 'string' && webmUrl.startsWith('/media/'), String(webmUrl));
    else check('local mode stores the video as an /uploads/ file', typeof webmUrl === 'string' && webmUrl.startsWith('/uploads/'), String(webmUrl));

    let res = await fetch(BASE + webmUrl);
    let served = Buffer.from(await res.arrayBuffer());
    check('webm serves back (200, video/webm, byte-identical)', res.status === 200 && (res.headers.get('content-type') || '').includes('video/webm') && served.equals(WEBM),
      `status ${res.status}, type ${res.headers.get('content-type')}, ${served.length} vs ${WEBM.length} bytes`);

    r = await A.postForm('/api/posts', mediaForm(MP4, 'video/mp4', 'recorded-video.mp4', 'An mp4 take 🎬'));
    check('mp4 video post succeeds (200, mediaType video)', r.status === 200 && r.data.post && r.data.post.mediaType === 'video', `got ${r.status}`);
    const mp4Url = r.data.post && r.data.post.mediaUrl;
    res = await fetch(BASE + mp4Url);
    served = Buffer.from(await res.arrayBuffer());
    check('mp4 serves back (200, video/mp4, byte-identical)', res.status === 200 && (res.headers.get('content-type') || '').includes('video/mp4') && served.equals(MP4),
      `status ${res.status}, type ${res.headers.get('content-type')}, ${served.length} vs ${MP4.length} bytes`);

    // --- the feed carries the recorded-video posts ---
    const B = new Client();
    r = await B.post('/api/signup', { displayName: 'Recorder B', username: `rb_${RUN}`, password: 'test-pass-1' });
    check('signup B succeeds', r.status === 200 && r.data.user);
    r = await B.get('/api/posts');
    const feedWebm = (r.data.posts || []).find((p) => p.mediaUrl === webmUrl);
    const feedMp4 = (r.data.posts || []).find((p) => p.mediaUrl === mp4Url);
    check("B's feed returns both video posts with their media URLs", !!feedWebm && !!feedMp4 && feedWebm.mediaType === 'video' && feedMp4.mediaType === 'video', JSON.stringify(r.data).slice(0, 200));

    if (ENGINE === 'libsql') {
      // --- HTTP Range on /media/:id (what makes blob videos play/seek) ---
      res = await fetch(BASE + webmUrl, { headers: { Range: 'bytes=10-19' } });
      served = Buffer.from(await res.arrayBuffer());
      check('Range bytes=10-19 -> 206 with the exact slice + Content-Range',
        res.status === 206 && res.headers.get('content-range') === `bytes 10-19/${WEBM.length}` && served.equals(WEBM.subarray(10, 20)),
        `status ${res.status}, range ${res.headers.get('content-range')}, ${served.length} bytes`);
      res = await fetch(BASE + webmUrl, { headers: { Range: 'bytes=100-' } });
      served = Buffer.from(await res.arrayBuffer());
      check('Range bytes=100- -> 206 to the end of the file',
        res.status === 206 && res.headers.get('content-range') === `bytes 100-${WEBM.length - 1}/${WEBM.length}` && served.equals(WEBM.subarray(100)),
        `status ${res.status}, range ${res.headers.get('content-range')}, ${served.length} bytes`);
      res = await fetch(BASE + webmUrl, { headers: { Range: 'bytes=-25' } });
      served = Buffer.from(await res.arrayBuffer());
      check('Range bytes=-25 -> 206 with the last 25 bytes',
        res.status === 206 && res.headers.get('content-range') === `bytes ${WEBM.length - 25}-${WEBM.length - 1}/${WEBM.length}` && served.equals(WEBM.subarray(WEBM.length - 25)),
        `status ${res.status}, range ${res.headers.get('content-range')}, ${served.length} bytes`);
      res = await fetch(BASE + webmUrl, { headers: { Range: 'bytes=999999-' } });
      check('Range past the end -> 416', res.status === 416, `got ${res.status}`);
      res = await fetch(BASE + webmUrl);
      check('plain GET of a video blob advertises Accept-Ranges: bytes', (res.headers.get('accept-ranges') || '') === 'bytes', String(res.headers.get('accept-ranges')));

      // --- cloud caps: video 20 MB, photo still 5 MB ---
      r = await A.postForm('/api/posts', mediaForm(Buffer.alloc(20 * 1024 * 1024 + 1, 5), 'video/webm', 'recorded-video.webm', 'way too long'));
      check('video over the 20 MB cloud cap refused (413)', r.status === 413, `got ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
      r = await A.postForm('/api/posts', mediaForm(Buffer.alloc(5 * 1024 * 1024 + 1, 6), 'image/png', 'big.png', 'way too big'));
      check('photo over the 5 MB cloud cap still refused (413)', r.status === 413, `got ${r.status}`);
      r = await A.postForm('/api/posts', mediaForm(PNG, 'image/png', 'small.png', 'small photo still fine'));
      check('small photo post still stores as a blob (200, /media/:id)', r.status === 200 && r.data.post && r.data.post.mediaType === 'image' && r.data.post.mediaUrl.startsWith('/media/'), `got ${r.status}`);
      res = await fetch(BASE + r.data.post.mediaUrl);
      served = Buffer.from(await res.arrayBuffer());
      check('small photo serves back byte-identical', res.status === 200 && served.equals(PNG), `status ${res.status}`);
    }
  } finally {
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
