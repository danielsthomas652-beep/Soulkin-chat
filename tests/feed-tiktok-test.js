'use strict';
/* mLT. chat — TikTok-style feed video cards test suite.
 *
 * The feed's video cards live in the browser, so this suite verifies
 * what a headless check honestly can: the served JS ships the big
 * TikTok-style renderer for video posts (tall stage, letterboxed
 * video over a blurred backdrop, author + caption overlaid, action
 * rail with the existing data-act hooks, sound button wired to the
 * global Sound ON/OFF choice), the IntersectionObserver autoplay
 * wiring (play at >=50% visible, pause when it leaves), tap-to-
 * pause/resume, and the picked-song sync — while the photo/text post
 * renderer and the Videos tab pager ship byte-for-byte the patterns
 * they had before. The unchanged feed API contract is exercised end
 * to end: signup -> text/photo/video posts -> a second user's feed,
 * like toggle and comment counts on the video post, and the Videos
 * catalog the pager reads.
 *
 * Real HTTP against a real running server, copied to a throwaway
 * temp dir (node_modules symlinked) so the shipped data/solkin.db
 * is never touched — same pattern as the other suites.
 *
 * Usage:
 *   node tests/feed-tiktok-test.js                # local engine
 *   node tests/feed-tiktok-test.js --engine=libsql # Turso facade on a file: DB
 *
 * NOT covered here (needs a human tap-through): actual autoplay on
 * a real phone (browser autoplay policies), scroll feel, how the
 * blurred backdrop looks, rail button reachability.
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
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-feed-tiktok-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: 'file:' + path.join(tmpRoot, 'test.db') }
    : {};
  console.log(`Feed TikTok test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  let child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    // --- served HTML: feed + Videos pager markup untouched ---
    const html = await (await fetch(BASE + '/')).text();
    check('HTML still serves the feed view + list', html.includes('id="view-feed"') && html.includes('id="feedList"'));
    check('Videos pager markup unchanged (pager, prev/next, sound pill)',
      html.includes('id="pager"') && html.includes('id="pgPrev"') && html.includes('id="pgNext"') && html.includes('id="soundPill"'));

    // --- served JS: the TikTok video card renderer ---
    const js = await (await fetch(BASE + '/app.js')).text();
    check('video posts route to a dedicated TikTok renderer', js.includes('function videoPostCardHTML') && js.includes("p.mediaType === 'video') return videoPostCardHTML"));
    check('renderer ships the tall stage + letterboxed video + blurred backdrop',
      js.includes('tk-stage') && js.includes('tk-video') && js.includes('tk-bg') && js.includes('data-post-video'));
    check('author + caption are overlaid on the card', js.includes('tk-meta') && js.includes('tk-author') && js.includes('tk-caption'));
    check('action rail ships with the existing like/comment/share hooks',
      js.includes('tk-rail') && js.includes('data-rail="1"') && js.includes('data-act="like"') && js.includes('data-act="comment"') && js.includes('data-act="share"'));
    check('report still reachable on a video card', js.includes('tk-report') && js.includes('data-act="report"'));
    check('rail sound button ships and drives the global Sound ON/OFF choice',
      js.includes('feed-sound-btn') && js.includes("closest('.feed-sound-btn')") && js.includes('applyFeedSounds()'));
    check('autoplay: IntersectionObserver plays at >=50% visible, pauses when it leaves',
      js.includes('IntersectionObserver') && js.includes('intersectionRatio >= 0.5') && js.includes('function playFeedVideo') && js.includes('getFeedObserver'));
    check('tap on the stage pauses / resumes', js.includes("stage.addEventListener('click'") && js.includes('else v.pause()'));
    check('picked song still syncs with its post video', js.includes('data-post-audio') && js.includes('syncAudio(v, audio)') && js.includes('function applyFeedSound'));
    check('like handler repaints rail buttons as icon + count', js.includes('b.dataset.rail') && js.includes('fmtCount(r.likeCount)'));
    check('photo/text post renderer is unchanged (head, text, image block, action row)',
      js.includes('class="post-head"') && js.includes('class="post-text"') && js.includes('class="post-media"><img') && js.includes('class="post-actions"'));
    check('old standard video block is GONE from the feed renderer',
      !js.includes('class="post-media"><video') && !js.includes('controls preload="metadata"'));
    check('Videos tab renderer unchanged (slides, side column, follow/like/music)',
      js.includes('function slideHTML') && js.includes('data-vlike') && js.includes('data-vfollow') && js.includes('data-vmusic') && js.includes('function setSlide'));

    // --- served CSS: TikTok stage + rail, pager untouched ---
    const css = await (await fetch(BASE + '/style.css')).text();
    check('CSS sizes the TikTok stage tall (~84vh)', css.includes('.tk-stage') && css.includes('84vh'));
    check('CSS letterboxes the clip (contain) over a blurred backdrop', css.includes('.tk-video') && css.includes('object-fit:contain') && css.includes('.tk-bg') && css.includes('blur(28px)'));
    check('CSS styles the overlay + right-edge rail', css.includes('.tk-meta') && css.includes('.tk-rail') && css.includes('.tk-act'));
    check('Videos pager CSS unchanged (mandatory sideways snap, 43vh slides)',
      css.includes('scroll-snap-type:x mandatory') && css.includes('.slide video') && css.includes('height:43vh'));

    // --- the unchanged feed API contract, exercised end to end ---
    const songs = await (await fetch(BASE + '/api/songs')).json();
    check('song catalog serves (picked songs ride on video posts)', Array.isArray(songs.songs) && songs.songs.length > 0);
    const songId = songs.songs[0].id;

    const A = new Client();
    let r = await A.post('/api/signup', { displayName: 'Feed A', username: `fa_${RUN}`, password: 'test-pass-1' });
    check('signup A succeeds', r.status === 200 && r.data.user, `got ${r.status}`);

    r = await A.post('/api/posts', { text: 'A plain text post', songId: null });
    check('text post created (no media)', r.status === 200 && r.data.post && !r.data.post.mediaUrl, `got ${r.status}`);
    const textId = r.data.post && r.data.post.id;

    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082', 'hex');
    const fd = new FormData();
    fd.append('text', 'A photo post 📷');
    fd.append('media', new Blob([png], { type: 'image/png' }), 'dot.png');
    const upRes = await fetch(BASE + '/api/posts', { method: 'POST', headers: { Cookie: A.cookieHeader() }, body: fd });
    const upData = await upRes.json().catch(() => ({}));
    check('photo post created as an image', upRes.status === 200 && upData.post && upData.post.mediaType === 'image', `got ${upRes.status}`);
    const photoId = upData.post && upData.post.id;

    r = await A.post('/api/posts', { text: 'My big video 🎬', mediaUrl: 'https://example.com/clip.mp4', mediaType: 'video', songId });
    check('video post created with its picked song attached',
      r.status === 200 && r.data.post && r.data.post.mediaType === 'video' && r.data.post.song && r.data.post.song.id === songId,
      `got ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    const videoId = r.data.post && r.data.post.id;

    const B = new Client();
    r = await B.post('/api/signup', { displayName: 'Feed B', username: `fb_${RUN}`, password: 'test-pass-1' });
    check('signup B succeeds', r.status === 200 && r.data.user);

    r = await B.get('/api/posts');
    const posts = (r.data && r.data.posts) || [];
    const vPost = posts.find((p) => p.id === videoId);
    check("B's feed carries A's video post in the shape the TikTok renderer consumes",
      !!vPost && vPost.mediaType === 'video' && vPost.mediaUrl === 'https://example.com/clip.mp4'
      && vPost.author && vPost.author.username === `fa_${RUN}`
      && typeof vPost.likeCount === 'number' && typeof vPost.commentCount === 'number' && vPost.likedByMe === false
      && vPost.song && vPost.song.src,
      JSON.stringify(vPost).slice(0, 200));
    check("B's feed still carries the text + photo posts for the classic renderer",
      posts.some((p) => p.id === textId && !p.mediaUrl) && posts.some((p) => p.id === photoId && p.mediaType === 'image'));
    check('seeded catalog video post is in the feed too (a real video card on first run)',
      posts.some((p) => p.mediaType === 'video' && p.id !== videoId && p.author && p.author.username === 'maya.sings'));

    r = await B.post(`/api/posts/${videoId}/like`, {});
    check('rail Like toggles on the video post', r.status === 200 && r.data.liked === true && r.data.likeCount === 1, `got ${r.status} ${JSON.stringify(r.data)}`);
    r = await B.get('/api/posts');
    const vLiked = ((r.data && r.data.posts) || []).find((p) => p.id === videoId);
    check('feed reflects the like (likedByMe + count for the rail)', !!vLiked && vLiked.likedByMe === true && vLiked.likeCount === 1);

    r = await B.post(`/api/posts/${videoId}/comments`, { text: 'Great clip! 🎬' });
    check('comment posts on the video post', r.status === 200 && r.data.comment, `got ${r.status}`);
    r = await B.get('/api/posts');
    const vCommented = ((r.data && r.data.posts) || []).find((p) => p.id === videoId);
    check('feed reflects the comment count for the rail', !!vCommented && vCommented.commentCount === 1);

    r = await B.post(`/api/posts/${videoId}/like`, {});
    check('rail Like toggles back off', r.status === 200 && r.data.liked === false && r.data.likeCount === 0);

    r = await B.get('/api/videos');
    check('Videos catalog the pager reads is unchanged',
      r.status === 200 && Array.isArray(r.data.videos) && r.data.videos.length > 0
      && r.data.videos[0].id && r.data.videos[0].src && r.data.videos[0].creator,
      `got ${r.status}`);
  } finally {
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
