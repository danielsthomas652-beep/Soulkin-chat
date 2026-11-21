'use strict';
/* mLT. chat — Videos slide-out controls drawer test suite.
 *
 * Served-file assertions (plus a light API sanity pass) in the style
 * of tests/feed-tiktok-test.js: boot a throwaway copy of the app and
 * read the files it serves. The shipped data/solkin.db is never
 * touched.
 *
 * Usage:
 *   node tests/video-drawer-test.js                # local engine
 *   node tests/video-drawer-test.js --engine=libsql # Turso facade on a file: DB
 *
 * The owner's ask under test (Videos tab only — the feed's TikTok
 * cards and everything else are untouched):
 *   * the playing video is BIG: a slide is all stage — full width,
 *     the pager's full height, no persistent control column sharing
 *     it — with only a slim author + caption line overlaid
 *     bottom-left;
 *   * every control (Like, Comment, Share, song line + change-song,
 *     Sound on/off, Follow) lives in ONE panel docked to the RIGHT
 *     edge, hidden off-canvas by default, sliding in/out with a short
 *     transition;
 *   * a leftward swipe starting in the ~24px right-edge strip of the
 *     video pulls the panel out; a rightward swipe anywhere, a swipe
 *     on the pager (an open panel never traps the pager — the first
 *     swipe closes it), or tapping the video tucks it back; a small
 *     "‹ Controls" edge tab keeps the drawer discoverable;
 *   * the panel is shared per-view and rebinds to the current video
 *     (renderVideoDrawer on open / slide change / sound repaint), and
 *     closes on slide change;
 *   * the pager's existing sideways swipe paging is untouched — the
 *     edge gesture is layered on top of it (touchmove is only
 *     preventDefaulted for the edge strip or while the panel is
 *     open).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ENGINE = (process.argv.find((a) => a.startsWith('--engine=')) || '--engine=local').split('=')[1];
const APP_SRC = path.join(__dirname, '..');
const PORT = 4050 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solkin-vdrawer-test-'));
  const appDir = path.join(tmpRoot, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['server', 'public']) fs.cpSync(path.join(APP_SRC, item), path.join(appDir, item), { recursive: true });
  fs.copyFileSync(path.join(APP_SRC, 'package.json'), path.join(appDir, 'package.json'));
  fs.symlinkSync(path.join(APP_SRC, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');

  const env = ENGINE === 'libsql'
    ? { TURSO_DATABASE_URL: `file:${path.join(tmpRoot, 'cloud.db')}`, TURSO_AUTH_TOKEN: 'test-token', SESSION_SECRET: 'test-secret' }
    : {};
  console.log(`Video drawer test suite — engine: ${ENGINE}, port: ${PORT}, app copy: ${appDir}`);

  let child = startServer(appDir, env);
  try {
    await waitReady(child);
    console.log('Server up. Running checks…');

    // --- served HTML: pager intact + drawer + edge tab ship ---
    const html = await (await fetch(BASE + '/')).text();
    check('Videos pager markup intact (pager, prev/next, sound pill)',
      html.includes('id="pager"') && html.includes('id="pgPrev"') && html.includes('id="pgNext"') && html.includes('id="soundPill"'));
    check('drawer panel + edge tab ship inside the Videos view',
      html.includes('id="vdrawer"') && html.includes('id="vdrawerTab"')
      && html.indexOf('id="view-videos"') < html.indexOf('id="vdrawer"')
      && html.indexOf('id="vdrawer"') < html.indexOf('id="view-people"'));
    check('edge tab is the always-visible "‹ Controls" hint', html.includes('‹<span>Controls</span>'));
    check('drawer starts hidden from assistive tech too', html.includes('id="vdrawer" aria-hidden="true"'));

    // --- served JS: full-stage slides ---
    const js = await (await fetch(BASE + '/app.js')).text();
    check('slide renderer no longer emits a control column',
      js.includes('function slideHTML') && !js.includes('side-col') && !js.includes('side-act'));
    check('the slide caption is a slim overlay line with the author on it',
      js.includes('who-line') && js.includes('v.creator.split'));
    check('feed TikTok cards are untouched by the fold-in',
      js.includes('function videoPostCardHTML') && js.includes('tk-rail'));

    // --- served JS: the drawer itself ---
    check('drawer renderer + open/close helpers ship',
      js.includes('function renderVideoDrawer') && js.includes('function openVideoDrawer')
      && js.includes('function closeVideoDrawer') && js.includes('function videoDrawerOpen'));
    check('drawer carries every control on the same hooks as before (+ share + sound)',
      js.includes('data-vlike') && js.includes('data-vfollow') && js.includes('data-vcomment')
      && js.includes('data-vmusic') && js.includes('data-vshare') && js.includes('data-vsound'));
    check('drawer shows the song line and the creator + Follow',
      js.includes('vd-song') && js.includes('No song on this one') && js.includes('vd-who') && js.includes('follow-btn'));
    check('drawer actions hit the same APIs (like / follow endpoints)',
      js.includes('/api/videos/${id}/like') && js.includes('/api/videos/${id}/follow'));
    check('the edge tab toggles the drawer',
      js.includes("$('#vdrawerTab').addEventListener('click'") && js.includes('closeVideoDrawer(); else openVideoDrawer()'));
    check('drawer rebinds on open and on sound repaint (current-slide binding)',
      js.includes('renderVideoDrawer(); // always bound to the video on screen right now')
      && js.includes('if (videosCache.length) renderVideoDrawer();'));

    // --- served JS: gestures, layered over the pager ---
    check('edge gesture watches the ~24px right-edge strip of the video',
      js.includes('rect.right - 24') && js.includes("getBoundingClientRect()"));
    check('edge-swipe open is wired on pager touchend',
      js.includes("$('#pager').addEventListener('touchend'") && js.includes('if (start.edge && dx < 0) openVideoDrawer();'));
    check('pager touchmove only holds the scroll for the edge strip or an open panel',
      js.includes("$('#pager').addEventListener('touchmove'") && js.includes('e.preventDefault()')
      && js.includes('if (vdTouch.edge && dx < -12)'));
    check('an open panel never traps the pager — first swipe closes it, no paging',
      js.includes('if (videoDrawerOpen()) { closeVideoDrawer(); return; } // first swipe closes the panel, never pages'));
    check('tapping the video tucks the panel away instead of opening the viewer',
      js.includes('if (videoDrawerOpen()) { closeVideoDrawer(); return; }') && js.includes('openViewer(currentSlide)'));
    check('a rightward swipe on the panel itself closes it',
      js.includes("$('#vdrawer').addEventListener('touchend'") && js.includes('if (dx > 36'));
    check('the drawer closes on slide change (setSlide + pager scroll settle)',
      (js.match(/closeVideoDrawer\(\)/g) || []).length >= 5
      && js.includes('closeVideoDrawer(); currentSlide = i')
      && js.includes("closeVideoDrawer(); } // the drawer never follows to another video"));
    check('leaving the Videos view closes the drawer',
      js.includes("if (name !== 'videos') closeVideoDrawer();"));
    check('existing pager machinery is intact (setSlide, prev/next, scroll-snap settle)',
      js.includes('function setSlide') && js.includes("$('#pgPrev')") && js.includes("$('#pgNext')")
      && js.includes("addEventListener('scroll'"));

    // --- served CSS: stage, overlay, drawer mechanics ---
    const css = await (await fetch(BASE + '/style.css')).text();
    check('slide is a full-bleed stage (no flex row, no padding sharing the stage)',
      css.includes('.slide{flex:0 0 100%') && css.includes('overflow:hidden') && !css.includes('.side-col') && !css.includes('.side-act'));
    check('video fills the slide at the approved big stage height',
      css.includes('.slide video') && css.includes('width:100%') && css.includes('height:min(70vh,680px)') && css.includes('min-height:320px'));
    check('caption is overlaid bottom-left over the video',
      css.includes('.slide .cap{position:absolute; left:12px; bottom:12px'));
    check('pager keeps its sideways snap paging',
      css.includes('.pager{display:flex') && css.includes('scroll-snap-type:x mandatory'));
    check('drawer docks right, hidden off-canvas, slides with a short transition',
      css.includes('.vdrawer{position:fixed; top:0; right:0; bottom:0') && css.includes('transform:translateX(105%)')
      && css.includes('transition:transform .25s ease') && css.includes('.vdrawer.open{transform:translateX(0)}'));
    check('edge tab is fixed to the right edge and tucks away while open',
      css.includes('.vdrawer-tab{position:fixed; right:0') && css.includes('.vdrawer-tab.tucked{opacity:0'));
    check('drawer buttons + song line are styled', css.includes('.vd-act') && css.includes('.vd-song') && css.includes('.vd-who'));

    // --- API sanity: the drawer's data source still serves ---
    const vids = await (await fetch(BASE + '/api/videos')).json();
    check('Videos catalog serves (the drawer binds to these clips)',
      Array.isArray(vids.videos) && vids.videos.length > 0
      && vids.videos.every((v) => 'likeCount' in v && 'commentCount' in v && 'creator' in v),
      JSON.stringify(vids).slice(0, 200));
  } finally {
    await stopServer(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nRESULT (${ENGINE}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
