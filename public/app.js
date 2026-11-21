'use strict';
/* ================= helpers ================= */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const AV_COLORS = ['#ef476f', '#f78c6b', '#e9a13b', '#06d6a0', '#118ab2', '#7b61c9', '#e23b4e', '#3a9ad9'];
function avColor(key) { let h = 0; const s = String(key || '?'); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
function initials(name) { const p = String(name || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
function avatarHTML(name, username, size) { return `<span class="avatar ${size || 'md'}" style="background:${avColor(username || name)}">${esc(initials(name))}</span>`; }
function timeAgo(iso) {
  const t = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('Z') ? '' : 'Z')).getTime();
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
let toastTimer = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2600); }
async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty */ }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
const ICON = {
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.7C6.4 17 3 13.6 3 9.9 3 7.2 5 5 7.6 5c1.7 0 3.4 1 4.4 2.4C13 6 14.7 5 16.4 5 19 5 21 7.2 21 9.9c0 3.7-3.4 7.1-9 10.8z"/></svg>',
  heartFill: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.7C6.4 17 3 13.6 3 9.9 3 7.2 5 5 7.6 5c1.7 0 3.4 1 4.4 2.4C13 6 14.7 5 16.4 5 19 5 21 7.2 21 9.9c0 3.7-3.4 7.1-9 10.8z"/></svg>',
  comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 5.5 20 12l-7 6.5v-4C7 14.5 4.5 16 3 18c0-6 3.5-9.5 10-10z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v11.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/></svg>',
};

/* ================= state ================= */
let me = null;
let songsCache = null;
let videosCache = [];
let soundOn = localStorage.getItem('solkin_sound') === '1';
let clipSongOverrides = {};
try { clipSongOverrides = JSON.parse(localStorage.getItem('solkin_clip_songs') || '{}'); } catch (e) { clipSongOverrides = {}; }

/* ================= auth ================= */
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  $('#tabLogin').classList.toggle('on', mode === 'login');
  $('#tabSignup').classList.toggle('on', mode === 'signup');
  $('#fName').classList.toggle('hidden', mode === 'login');
  $('#fYoung').classList.toggle('hidden', mode === 'login');
  $('#authSubmit').textContent = mode === 'login' ? 'Log in' : 'Sign up 🎉';
  $('#inPass').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  $('#authErr').classList.add('hidden');
}
$('#tabLogin').addEventListener('click', () => setAuthMode('login'));
$('#tabSignup').addEventListener('click', () => setAuthMode('signup'));
$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#authErr'); err.classList.add('hidden');
  const btn = $('#authSubmit'); btn.disabled = true;
  try {
    let data;
    if (authMode === 'signup') {
      data = await api('/api/signup', { method: 'POST', body: JSON.stringify({ displayName: $('#inName').value, username: $('#inUser').value, password: $('#inPass').value, under18: $('#inYoung').checked }) });
    } else {
      data = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#inUser').value, password: $('#inPass').value }) });
    }
    me = data.user;
    enterApp();
    toast(authMode === 'signup' ? 'Welcome to mLT. chat! 🎉' : 'Welcome back! 👋');
  } catch (ex) {
    err.textContent = ex.message; err.classList.remove('hidden');
  } finally { btn.disabled = false; }
});

/* ================= nav ================= */
let currentView = 'feed';
function showView(name) {
  currentView = name;
  ['feed', 'videos', 'people', 'friends', 'chat', 'map', 'profile'].forEach((v) => $('#view-' + v).classList.toggle('hidden', v !== name));
  $$('.bottomnav button').forEach((b) => b.classList.toggle('on', b.dataset.nav === name));
  if (name === 'videos') { ensureVideos(); resumeCurrentSlide(); }
  else pauseAllSlides();
  if (name === 'people') loadPeople();
  if (name === 'friends') loadFriends();
  if (name === 'chat') loadConversations();
  if (name === 'map') loadMap();
  if (name === 'profile') loadProfile();
  window.scrollTo(0, 0);
}
$$('.bottomnav button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.nav)));

/* ================= swipe between pages =================
 * A clear left/right swipe moves between the main tabs in bottom-nav
 * order (Feed → Videos → People → Friends → Chat → Map → Profile). The Videos view
 * itself is skipped — its pager owns horizontal swiping there — and a
 * swipe that starts in a form field, the top/bottom bars, an open
 * overlay, a horizontally scrolling strip, or the friend map (Leaflet
 * owns panning there) never changes the page.
 * The gesture must travel ~60px and be mostly horizontal, so ordinary
 * vertical scrolling never triggers it. */
const TAB_ORDER = ['feed', 'videos', 'people', 'friends', 'chat', 'map', 'profile'];
function anyOverlayOpen() {
  return ['#viewer', '#callView', '#postEditor', '#cameraView', '#threadView', '#snapView', '#sheet', '#callPopup', '#knowConfirm'].some((s) => !$(s).classList.contains('hidden'));
}
function insideHScroller(el) {
  while (el && el !== document.body) {
    if (el.classList && el.classList.contains('pager')) return true;
    const cs = window.getComputedStyle(el);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4) return true;
    el = el.parentElement;
  }
  return false;
}
let swipeStart = null;
document.addEventListener('touchstart', (e) => {
  swipeStart = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, target: e.target } : null;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!swipeStart) return;
  const start = swipeStart; swipeStart = null;
  if (currentView === 'videos' || anyOverlayOpen()) return;
  const t = start.target;
  if (t && t.closest && (t.closest('input, textarea, select') || t.closest('.bottomnav') || t.closest('.topbar') || t.closest('#mapEl') || insideHScroller(t))) return;
  const dx = e.changedTouches[0].clientX - start.x;
  const dy = e.changedTouches[0].clientY - start.y;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
  const i = TAB_ORDER.indexOf(currentView);
  const next = dx < 0 ? i + 1 : i - 1;
  if (next < 0 || next >= TAB_ORDER.length) return;
  showView(TAB_ORDER[next]);
}, { passive: true });

function enterApp() {
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#meAvatar').innerHTML = avatarHTML(me.displayName, me.username, 'sm');
  $('#meName').textContent = me.displayName.split(' ')[0];
  $('#composerAvatar').innerHTML = avatarHTML(me.displayName, me.username, 'md');
  loadFeed();
  showView('feed');
  connectWS();
  refreshUnreadBadge();
  startLocationUpdates();
}

/* ================= feed ================= */
function songForPost(p) { return p.song || null; }
function postCardHTML(p) {
  const a = p.author || {};
  const badge = a.isProtected ? '<span class="badge">🛡️ Protected</span>' : '';
  let media = '';
  if (p.mediaUrl && p.mediaType === 'image') media = `<div class="post-media"><img src="${esc(p.mediaUrl)}" alt="photo" loading="lazy"></div>`;
  else if (p.mediaUrl && p.mediaType === 'video') {
    const song = songForPost(p);
    media = `<div class="post-media"><video src="${esc(p.mediaUrl)}" playsinline loop controls preload="metadata" ${song ? 'muted' : ''} data-post-video="${p.id}"></video></div>` +
      (song ? `<div class="post-song"><span class="pill">🎵 ${esc(song.title)} — ${esc(song.artist)}</span></div><audio data-post-audio="${p.id}" src="${esc(song.src)}" loop preload="none"></audio>` : '');
  }
  return `<article class="card" id="post-${p.id}">
    <div class="post-head">${avatarHTML(a.displayName, a.username, 'md')}
      <div><div class="nm">${esc(a.displayName)}${badge}</div><div class="sub">@${esc(a.username)} · ${timeAgo(p.createdAt)}</div></div>
    </div>
    ${p.text ? `<p class="post-text">${esc(p.text)}</p>` : ''}
    ${media}
    <div class="post-actions">
      <button data-act="like" data-id="${p.id}" class="${p.likedByMe ? 'liked' : ''}">${p.likedByMe ? ICON.heartFill : ICON.heart}<span>Like${p.likeCount ? ' · ' + p.likeCount : ''}</span></button>
      <button data-act="comment" data-id="${p.id}">${ICON.comment}<span>Comment${p.commentCount ? ' · ' + p.commentCount : ''}</span></button>
      <button data-act="share" data-id="${p.id}">${ICON.share}<span>Share</span></button>
      <button data-act="report" data-id="${p.id}">${ICON.flag}<span>Report</span></button>
    </div>
    <div class="comments hidden" id="comments-${p.id}"></div>
  </article>`;
}
function wirePostMedia(container) {
  $$('video[data-post-video]', container).forEach((v) => {
    const audio = container.querySelector(`audio[data-post-audio="${v.dataset.postVideo}"]`);
    if (!audio) return;
    v.addEventListener('play', () => { audio.play().catch(() => {}); });
    v.addEventListener('pause', () => audio.pause());
    v.addEventListener('seeked', () => { if (audio.duration) audio.currentTime = v.currentTime % audio.duration; });
  });
}
async function loadFeed() {
  try {
    const data = await api('/api/posts');
    const list = $('#feedList');
    list.innerHTML = data.posts.length ? data.posts.map(postCardHTML).join('') : '<div class="card empty">Nothing here yet — be the first to post! 🎈</div>';
    wirePostMedia(list);
  } catch (e) { toast(e.message); }
}

/* feed actions (event delegation) */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = +btn.dataset.id, act = btn.dataset.act;
  try {
    if (act === 'like') {
      const r = await api(`/api/posts/${id}/like`, { method: 'POST', body: '{}' });
      $$(`[data-act="like"][data-id="${id}"]`).forEach((b) => { b.classList.toggle('liked', r.liked); b.innerHTML = `${r.liked ? ICON.heartFill : ICON.heart}<span>Like${r.likeCount ? ' · ' + r.likeCount : ''}</span>`; });
    } else if (act === 'comment') {
      openCommentsSheet({ kind: 'post', id });
    } else if (act === 'share') {
      const link = location.origin + '/#post-' + id;
      try { await navigator.clipboard.writeText(link); toast('Link copied — send it to a friend! 🔗'); }
      catch (ex) { window.prompt('Copy this link:', link); }
    } else if (act === 'report') {
      openReportSheet(id);
    }
  } catch (ex) { toast(ex.message); }
});

/* ================= composer (entry point) + post editor =================
 * The feed composer no longer posts directly. Tapping its text box or
 * the Photo / Video / Music buttons opens the full-screen Post Editor,
 * and nothing is published until Post is tapped there. The editor owns
 * the draft: media preview, caption, and an optional song for a video. */
let editorFile = null; // {file, kind:'image'|'video', url}
let editorSong = null;
let editorIsOpen = false;

function openEditor(focusText) {
  if (!editorIsOpen) {
    // a fresh draft starts from whatever was typed in the feed composer
    $('#editorText').value = $('#composerText').value;
    editorIsOpen = true;
  }
  $('#postEditor').classList.remove('hidden');
  renderEditor();
  if (focusText) { const t = $('#editorText'); try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); } }
}
function closeEditor() {
  $('#postEditor').classList.add('hidden');
  editorIsOpen = false;
}
function discardEditor() {
  clearEditorFile();
  editorSong = null;
  $('#editorText').value = '';
  $('#composerText').value = '';
  renderEditor();
  closeEditor();
}
function setEditorFile(file, kind) {
  clearEditorFile();
  editorFile = { file, kind, url: URL.createObjectURL(file) };
  if (kind !== 'video' && editorSong) editorSong = null; // songs ride on videos only
  renderEditor();
}
function clearEditorFile() {
  if (editorFile) URL.revokeObjectURL(editorFile.url);
  editorFile = null;
}
function renderEditor() {
  const box = $('#editorMedia');
  box.innerHTML = editorFile
    ? (editorFile.kind === 'image'
      ? `<img src="${editorFile.url}" alt="Your photo">`
      : `<video src="${editorFile.url}" controls playsinline></video>`)
    : '<div class="editor-media-empty"><div class="eme-icon">🖼️</div><div>Add a photo or video below</div></div>';
  $('#edBtnPhoto').textContent = editorFile && editorFile.kind === 'image' ? '📷 Change photo' : '📷 Add photo';
  $('#edBtnVideo').textContent = editorFile && editorFile.kind === 'video' ? '🎬 Change video' : '🎬 Add video';
  $('#edBtnRemoveMedia').classList.toggle('hidden', !editorFile);
  renderEditorSong();
}
function renderEditorSong() {
  $('#editorSong').innerHTML = editorSong ? `<span class="song-tag">🎵 ${esc(editorSong.title)} — ${esc(editorSong.artist)} <button id="edRmSong" type="button" aria-label="Remove song">✕</button></span>` : '';
  const rm = $('#edRmSong'); if (rm) rm.addEventListener('click', () => { editorSong = null; renderEditorSong(); });
}

/* feed composer = entry points into the editor */
$('#composerText').addEventListener('click', () => openEditor(true));
$('#btnPhoto').addEventListener('click', () => $('#filePhoto').click());
$('#btnVideoFile').addEventListener('click', () => $('#fileVideo').click());
$('#btnMusic').addEventListener('click', () => openEditor(false));
$('#filePhoto').addEventListener('change', (e) => { if (e.target.files[0]) { setEditorFile(e.target.files[0], 'image'); openEditor(false); } e.target.value = ''; });
$('#fileVideo').addEventListener('change', (e) => { if (e.target.files[0]) { setEditorFile(e.target.files[0], 'video'); openEditor(false); } e.target.value = ''; });

/* editor buttons */
$('#edBtnPhoto').addEventListener('click', () => $('#filePhoto').click());
$('#edBtnVideo').addEventListener('click', () => $('#fileVideo').click());
$('#edBtnRemoveMedia').addEventListener('click', () => { clearEditorFile(); editorSong = null; renderEditor(); });
$('#edBtnMusic').addEventListener('click', () => {
  if (!editorFile || editorFile.kind !== 'video') { toast('Pick a video first, then add music 🎬'); return; }
  openMusicPicker({ type: 'editor' });
});
$('#editorCancel').addEventListener('click', discardEditor);
$('#editorPost').addEventListener('click', async () => {
  const text = $('#editorText').value.trim();
  if (!text && !editorFile) { toast("Write something or add a picture first 🙂"); return; }
  const btn = $('#editorPost'); btn.disabled = true; btn.textContent = 'Posting…';
  try {
    let data;
    if (editorFile) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('media', editorFile.file);
      if (editorSong && editorFile.kind === 'video') fd.append('songId', editorSong.id);
      const res = await fetch('/api/posts', { method: 'POST', body: fd });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Post failed.');
    } else {
      data = await api('/api/posts', { method: 'POST', body: JSON.stringify({ text, songId: null }) });
    }
    discardEditor();
    showView('feed');
    const list = $('#feedList');
    const empty = list.querySelector('.empty'); if (empty) empty.remove();
    list.insertAdjacentHTML('afterbegin', postCardHTML(data.post));
    wirePostMedia(list);
    toast('Posted! 🎉');
  } catch (ex) { toast(ex.message); }
  finally { btn.disabled = false; btn.textContent = 'Post'; }
});

/* ================= camera =================
 * Snapchat-style in-app camera. The Camera buttons (feed composer and
 * Post Editor) open a full-screen viewfinder that starts on the REAR
 * camera (facingMode 'environment') so you can photograph other people;
 * Flip switches to the front camera ('user') and back. Take picture
 * draws the current frame to a canvas and produces a JPEG File.
 * Where the photo goes depends on who opened the camera (camTarget):
 *   'editor' (default) — drops into the Post Editor as the draft's
 *     photo, the exact same setEditorFile() state the gallery picker
 *     feeds, so posting works exactly as before.
 *   'thread' — sends it straight to the friend whose message thread is
 *     open (sendThreadPhoto), as a photo DM.
 *   'snap' — sends it to that same friend as a DISAPPEARING snap
 *     (sendThreadSnap): they get one look, then the picture is deleted.
 * Leaving the camera screen (capture, ✕, Escape) always stops its
 * tracks; closing without capturing changes nothing. */
let camStream = null;
let camFacing = 'environment'; // rear camera first — for photographing other people
let camTarget = 'editor'; // 'editor' | 'thread' | 'snap' — set by openCamera()

function cameraErrorMessage(e) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || (e && e.name === 'UnsupportedError')) {
    return 'This browser cannot open a camera here. Try Chrome or Safari on your phone, on the secure (https) address.';
  }
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return 'Camera is blocked. Allow the camera for this site in your browser settings, then try again.';
  if (e && e.name === 'NotFoundError') return 'No camera was found on this device.';
  if (e && (e.name === 'NotReadableError' || e.name === 'AbortError')) return 'Your camera is busy in another app right now. Close that app and try again.';
  if (e && e.name === 'OverconstrainedError') return 'That camera is not available on this device.';
  return 'The camera could not start. Please try again.';
}
function stopCameraStream() {
  if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
  const v = $('#camVideo'); if (v) v.srcObject = null;
}
async function startCameraStream() {
  stopCameraStream();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const err = new Error('getUserMedia is not available'); err.name = 'UnsupportedError'; throw err;
  }
  camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: camFacing }, audio: false });
  const v = $('#camVideo');
  v.srcObject = camStream;
  try { await v.play(); } catch (e) { /* the stream still shows once the browser starts it */ }
  $('#camHint').textContent = camFacing === 'environment'
    ? 'Back camera — point it at your picture, then tap the big button 📸'
    : 'Front camera — tap the big button when you\'re ready 📸';
}
async function openCamera(target) {
  camTarget = (target === 'thread' || target === 'snap') ? target : 'editor';
  $('#cameraView').classList.remove('hidden');
  $('#camHint').textContent = 'Starting your camera…';
  try { await startCameraStream(); }
  catch (e) { closeCamera(); toast(cameraErrorMessage(e)); }
}
function closeCamera() {
  stopCameraStream();
  $('#cameraView').classList.add('hidden');
}
async function flipCamera() {
  camFacing = camFacing === 'environment' ? 'user' : 'environment';
  try { await startCameraStream(); }
  catch (e) { closeCamera(); toast(cameraErrorMessage(e)); }
}
function capturePhoto() {
  const v = $('#camVideo');
  if (!camStream || !v.videoWidth) { toast('The camera is still warming up — give it a second and try again.'); return; }
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => {
    if (!blob) { toast('That picture did not come out — try again.'); return; }
    const file = new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' });
    const target = camTarget;
    closeCamera();
    if (target === 'thread') { sendThreadPhoto(file); return; } // photo DM to the open thread
    if (target === 'snap') { sendThreadSnap(file); return; } // disappearing snap to the open thread
    setEditorFile(file, 'image'); // the same draft state the gallery picker feeds
    openEditor(false);
    toast('Got it! Add some words, then tap Post 📸');
  }, 'image/jpeg', 0.92);
}
$('#btnCamera').addEventListener('click', () => openCamera('editor'));
$('#edBtnCamera').addEventListener('click', () => openCamera('editor'));
$('#camClose').addEventListener('click', closeCamera);
$('#camFlip').addEventListener('click', flipCamera);
$('#camCapture').addEventListener('click', capturePhoto);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#cameraView').classList.contains('hidden')) closeCamera();
});

/* ================= videos ================= */
let videosLoaded = false;
let currentSlide = 0;
function clipSong(v) {
  const override = clipSongOverrides[v.id];
  if (override && songsCache) { const s = songsCache.find((x) => x.id === override); if (s) return s; }
  return v.song || null;
}
function slideHTML(v, i) {
  const song = clipSong(v);
  return `<div class="slide" data-slide="${i}">
    <div class="vid">
      <video src="${esc(v.src)}" playsinline loop muted preload="metadata" data-vid="${v.id}"></video>
      ${song ? `<audio data-clip-audio="${v.id}" src="${esc(song.src)}" loop preload="none"></audio>` : ''}
      <div class="cap"><span class="cat">${esc(v.cat)}</span><br>${esc(v.caption)}</div>
    </div>
    <div class="side-col">
      <div class="who">${avatarHTML(v.creator, v.creator, 'md')}<span class="nm">${esc(v.creator.split(' ')[0])}</span>
      <button class="follow-btn ${v.following ? 'following' : ''}" data-vfollow="${v.id}" type="button">${v.following ? 'Following' : 'Follow'}</button></div>
      <button class="side-act ${v.likedByMe ? 'liked' : ''}" data-vlike="${v.id}" type="button">${v.likedByMe ? ICON.heartFill : ICON.heart}<span class="cnt">${fmtCount(v.likeCount)}</span></button>
      <button class="side-act" data-vcomment="${v.id}" type="button">${ICON.comment}<span class="cnt">${v.commentCount || ''}</span></button>
      <button class="side-act" data-vmusic="${v.id}" type="button">${ICON.note}<span class="cnt">${song ? esc(shortTitle(song.title)) : 'Add'}</span></button>
    </div>
  </div>`;
}
function fmtCount(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n || 0); }
function shortTitle(t) { return t.length > 9 ? t.slice(0, 8) + '…' : t; }

async function ensureVideos() {
  if (videosLoaded) return;
  videosLoaded = true;
  try {
    if (!songsCache) { const s = await api('/api/songs'); songsCache = s.songs; }
    const data = await api('/api/videos');
    videosCache = data.videos;
    renderPager();
  } catch (e) { toast(e.message); }
}
function renderPager() {
  const pager = $('#pager');
  pager.innerHTML = videosCache.map(slideHTML).join('');
  updatePagerUI();
  requestAnimationFrame(() => setSlide(0, false));
}
function slideEls() { return $$('#pager .slide'); }
function slideVideo(i) { const s = slideEls()[i]; return s ? s.querySelector('video') : null; }
function slideAudio(i) { const s = slideEls()[i]; return s ? s.querySelector('audio') : null; }

function applySoundToSlide(i) {
  const v = videosCache[i]; if (!v) return;
  const vid = slideVideo(i), aud = slideAudio(i);
  if (!vid) return;
  const song = clipSong(v);
  if (!soundOn) { vid.muted = true; if (aud) aud.pause(); return; }
  if (song) { // a song IS this clip's sound
    vid.muted = true;
    if (aud) { aud.muted = false; aud.volume = 1; if (!vid.paused) { syncAudio(vid, aud); aud.play().catch(() => {}); } }
  } else if (v.hasOwnAudio) {
    vid.muted = false; vid.volume = 1; if (aud) aud.pause();
  } else { vid.muted = true; if (aud) aud.pause(); }
}
function syncAudio(vid, aud) {
  if (aud.duration && Math.abs(aud.currentTime - (vid.currentTime % aud.duration)) > 0.6) {
    aud.currentTime = vid.currentTime % aud.duration;
  }
}
function playSlide(i) {
  const vid = slideVideo(i); if (!vid) return;
  vid.play().then(() => applySoundToSlide(i)).catch(() => { vid.muted = true; vid.play().catch(() => {}); });
  applySoundToSlide(i);
}
function pauseSlide(i) {
  const vid = slideVideo(i), aud = slideAudio(i);
  if (vid) vid.pause();
  if (aud) aud.pause();
}
function pauseAllSlides() { slideEls().forEach((_, i) => pauseSlide(i)); }
function resumeCurrentSlide() { if (videosLoaded && !$('#view-videos').classList.contains('hidden')) playSlide(currentSlide); }
function setSlide(i, scroll) {
  const n = videosCache.length; if (!n) return;
  i = Math.max(0, Math.min(n - 1, i));
  if (i !== currentSlide) pauseSlide(currentSlide);
  currentSlide = i;
  if (scroll !== false) { const pager = $('#pager'); pager.scrollTo({ left: i * pager.clientWidth, behavior: 'smooth' }); }
  updatePagerUI();
  playSlide(i);
}
function updatePagerUI() {
  $('#pgCount').textContent = (currentSlide + 1) + ' / ' + Math.max(1, videosCache.length);
  $('#pgPrev').disabled = currentSlide <= 0;
  $('#pgNext').disabled = currentSlide >= videosCache.length - 1;
  renderSoundPills();
}
function renderSoundPills() {
  const label = soundOn ? '🔊 Sound ON' : '🔇 Sound OFF';
  const pill = $('#soundPill'); pill.textContent = label; pill.classList.toggle('on', soundOn);
  const vp = $('#viewerSound'); vp.textContent = label; vp.classList.toggle('on', soundOn);
}
function setSound(on) {
  soundOn = on;
  localStorage.setItem('solkin_sound', on ? '1' : '0');
  renderSoundPills();
  applySoundToSlide(currentSlide);
  if (!$('#viewer').classList.contains('hidden')) applyViewerSound();
  toast(on ? 'Sound on 🔊' : 'Sound off 🔇');
}
$('#soundPill').addEventListener('click', () => setSound(!soundOn));
$('#viewerSound').addEventListener('click', () => setSound(!soundOn));
$('#pgPrev').addEventListener('click', () => setSlide(currentSlide - 1));
$('#pgNext').addEventListener('click', () => setSlide(currentSlide + 1));
let scrollTick = null;
$('#pager').addEventListener('scroll', () => {
  clearTimeout(scrollTick);
  scrollTick = setTimeout(() => {
    const pager = $('#pager');
    const i = Math.round(pager.scrollLeft / pager.clientWidth);
    if (i !== currentSlide && videosCache[i]) { pauseSlide(currentSlide); currentSlide = i; updatePagerUI(); playSlide(i); }
  }, 90);
});
/* tap a slide video -> full-screen viewer; side-column actions */
$('#pager').addEventListener('click', async (e) => {
  const vid = e.target.closest('video[data-vid]');
  if (vid) { openViewer(currentSlide); return; }
  const like = e.target.closest('[data-vlike]');
  const follow = e.target.closest('[data-vfollow]');
  const comment = e.target.closest('[data-vcomment]');
  const music = e.target.closest('[data-vmusic]');
  try {
    if (like) {
      const id = like.dataset.vlike;
      const r = await api(`/api/videos/${id}/like`, { method: 'POST', body: '{}' });
      const v = videosCache.find((x) => x.id === id); if (v) { v.likedByMe = r.liked; v.likeCount = r.likeCount; }
      like.classList.toggle('liked', r.liked);
      like.innerHTML = `${r.liked ? ICON.heartFill : ICON.heart}<span class="cnt">${fmtCount(r.likeCount)}</span>`;
    } else if (follow) {
      const id = follow.dataset.vfollow;
      const r = await api(`/api/videos/${id}/follow`, { method: 'POST', body: '{}' });
      videosCache.forEach((v) => { if (v.creator === r.creator) v.following = r.following; });
      $$(`[data-vfollow]`).forEach((b) => {
        const v = videosCache.find((x) => x.id === b.dataset.vfollow);
        if (v && v.creator === r.creator) { b.classList.toggle('following', r.following); b.textContent = r.following ? 'Following' : 'Follow'; }
      });
      toast(r.following ? 'Following ' + r.creator + ' ⭐' : 'Unfollowed');
    } else if (comment) {
      openCommentsSheet({ kind: 'video', id: comment.dataset.vcomment });
    } else if (music) {
      openMusicPicker({ type: 'video', id: music.dataset.vmusic });
    }
  } catch (ex) { toast(ex.message); }
});

/* ================= full-screen viewer ================= */
let viewerIdx = 0;
function openViewer(i) {
  viewerIdx = i;
  pauseAllSlides();
  $('#viewer').classList.remove('hidden');
  loadViewerClip();
}
function closeViewer() {
  const vv = $('#viewerVideo'); vv.pause(); $('#viewerAudio').pause();
  $('#viewer').classList.add('hidden');
  resumeCurrentSlide();
}
function loadViewerClip() {
  const v = videosCache[viewerIdx]; if (!v) return;
  const vv = $('#viewerVideo'), va = $('#viewerAudio');
  $('#viewerTitle').textContent = v.creator + ' · ' + v.cat;
  vv.src = v.src;
  const song = clipSong(v);
  if (song) { va.src = song.src; } else { va.removeAttribute('src'); va.load(); }
  vv.loop = true;
  vv.play().then(() => applyViewerSound()).catch(() => { vv.muted = true; vv.play().catch(() => {}); applyViewerSound(); });
  $('#viewerPrev').style.visibility = viewerIdx > 0 ? 'visible' : 'hidden';
  $('#viewerNext').style.visibility = viewerIdx < videosCache.length - 1 ? 'visible' : 'hidden';
}
function applyViewerSound() {
  const v = videosCache[viewerIdx]; if (!v) return;
  const vv = $('#viewerVideo'), va = $('#viewerAudio');
  const song = clipSong(v);
  if (!soundOn) { vv.muted = true; va.pause(); return; }
  if (song) { vv.muted = true; va.muted = false; va.volume = 1; if (!vv.paused) { syncAudio(vv, va); va.play().catch(() => {}); } }
  else if (v.hasOwnAudio) { vv.muted = false; vv.volume = 1; va.pause(); }
  else { vv.muted = true; va.pause(); }
}
function viewerGo(d) {
  const n = viewerIdx + d;
  if (n < 0 || n >= videosCache.length) return;
  $('#viewerVideo').pause(); $('#viewerAudio').pause();
  viewerIdx = n;
  loadViewerClip();
}
$('#viewerClose').addEventListener('click', closeViewer);
$('#viewerPrev').addEventListener('click', () => viewerGo(-1));
$('#viewerNext').addEventListener('click', () => viewerGo(1));
$('#viewerVideo').addEventListener('click', () => {
  const vv = $('#viewerVideo');
  if (vv.paused) { vv.play().catch(() => {}); applyViewerSound(); } else { vv.pause(); $('#viewerAudio').pause(); }
});
let touchX = null;
$('#viewer').addEventListener('touchstart', (e) => { touchX = e.changedTouches[0].clientX; }, { passive: true });
$('#viewer').addEventListener('touchend', (e) => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX; touchX = null;
  if (Math.abs(dx) > 48) viewerGo(dx < 0 ? 1 : -1);
}, { passive: true });
document.addEventListener('keydown', (e) => {
  if ($('#viewer').classList.contains('hidden')) return;
  if (e.key === 'Escape') closeViewer();
  if (e.key === 'ArrowRight') viewerGo(1);
  if (e.key === 'ArrowLeft') viewerGo(-1);
});

/* ================= sheet (comments / music / report) ================= */
function openSheet(title) { $('#sheetTitle').textContent = title; $('#sheet').classList.remove('hidden'); }
function closeSheet() { $('#sheet').classList.add('hidden'); stopPreview(); }
$('#sheetClose').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', (e) => { if (e.target === $('#sheet')) closeSheet(); });

async function openCommentsSheet({ kind, id }) {
  openSheet('Comments 💬');
  const body = $('#sheetBody');
  body.innerHTML = '<p class="empty">Loading…</p>';
  const path = kind === 'post' ? `/api/posts/${id}/comments` : `/api/videos/${id}/comments`;
  try {
    const data = await api(path);
    body.innerHTML = `<div id="sheetComments">${data.comments.length ? data.comments.map(commentHTML).join('') : '<p class="empty">No comments yet — say something nice! 🙂</p>'}</div>
      <form class="comment-form" id="sheetCommentForm"><input id="sheetCommentText" maxlength="500" placeholder="Write a comment…"><button type="submit">Send</button></form>`;
    $('#sheetCommentForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const input = $('#sheetCommentText');
      const text = input.value.trim(); if (!text) return;
      try {
        const r = await api(path, { method: 'POST', body: JSON.stringify({ text }) });
        const box = $('#sheetComments');
        const empty = box.querySelector('.empty'); if (empty) empty.remove();
        box.insertAdjacentHTML('beforeend', commentHTML(r.comment));
        input.value = '';
        if (kind === 'post') loadFeed();
        else { const v = videosCache.find((x) => x.id === id); if (v) v.commentCount = (v.commentCount || 0) + 1; renderPagerSoft(); }
      } catch (ex) { toast(ex.message); }
    });
  } catch (e) { body.innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; }
}
function commentHTML(c) {
  const a = c.author || {};
  return `<div class="comment">${avatarHTML(a.displayName, a.username, 'sm')}<div class="bubble"><b>${esc(a.displayName)}</b> ${esc(c.text)}<br><span style="color:var(--muted); font-size:12px">${timeAgo(c.createdAt)}</span></div></div>`;
}
function renderPagerSoft() {
  // refresh side-column counts without losing scroll position
  const pager = $('#pager'); const left = pager.scrollLeft;
  pager.innerHTML = videosCache.map(slideHTML).join('');
  pager.scrollLeft = left;
  playSlide(currentSlide);
}
function openReportSheet(postId) {
  openSheet('Report this post');
  const reasons = ['Spam', 'Mean or hurtful', 'Scam', 'Something else'];
  $('#sheetBody').innerHTML = '<p style="color:var(--muted); margin-top:0">What is wrong with it? We will take a look.</p>' +
    reasons.map((r) => `<button class="btn ghost block" style="margin-bottom:8px" data-reason="${esc(r)}" type="button">${esc(r)}</button>`).join('');
  $$('#sheetBody [data-reason]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/posts/${postId}/report`, { method: 'POST', body: JSON.stringify({ reason: b.dataset.reason }) });
      closeSheet();
      toast('Thanks — we will take a look. 🛡️');
    } catch (ex) { toast(ex.message); }
  }));
}

/* ================= music picker ================= */
const previewAudio = new Audio();
let previewingId = null;
function stopPreview() { previewAudio.pause(); previewingId = null; $$('.song-row .prev').forEach((b) => (b.textContent = '▶ Hear')); }
const CAT_COLORS = { 'Pop': '#ef476f', 'Hip-Hop': '#7b61c9', 'Chill': '#118ab2', 'Party': '#e23b4e', 'Country': '#e9a13b', 'Rock': '#3a4a6b', 'Feel-good': '#06d6a0' };
let musicTarget = null; // {type:'editor'} | {type:'video', id}
let musicCat = 'All', musicQuery = '';
async function openMusicPicker(target) {
  musicTarget = target;
  if (!songsCache) { const s = await api('/api/songs'); songsCache = s.songs; }
  openSheet(target.type === 'video' ? 'Pick a song for this video 🎵' : 'Add music to your video 🎵');
  renderMusicPicker();
}
function renderMusicPicker() {
  const cats = ['All'].concat(Array.from(new Set(songsCache.map((s) => s.cat))));
  const list = songsCache.filter((s) => (musicCat === 'All' || s.cat === musicCat) && (s.title + ' ' + s.artist).toLowerCase().includes(musicQuery.toLowerCase()));
  $('#sheetBody').innerHTML = `<input class="search-in" id="musicSearch" placeholder="Search songs…" value="${esc(musicQuery)}">
    <div class="cat-chips">${cats.map((c) => `<button type="button" data-mcat="${esc(c)}" class="${c === musicCat ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>
    <div>${list.length ? list.map((s) => `<div class="song-row">
        <span class="note" style="background:${CAT_COLORS[s.cat] || '#16305e'}">♪</span>
        <span class="grow"><span class="ttl">${esc(s.title)}</span><br><span class="sub">${esc(s.artist)} · ${esc(s.genre)}</span></span>
        <button class="prev" data-prev="${s.id}" type="button">${previewingId === s.id ? '⏸ Stop' : '▶ Hear'}</button>
        <button class="use" data-use="${s.id}" type="button">Use</button>
      </div>`).join('') : '<p class="empty">No songs match that search.</p>'}</div>
    <p style="color:var(--muted); font-size:12px; text-align:center">Free-license music by Kevin MacLeod (incompetech.com)</p>`;
  $('#musicSearch').addEventListener('input', (e) => { musicQuery = e.target.value; renderMusicPicker(); const el = $('#musicSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  $$('#sheetBody [data-mcat]').forEach((b) => b.addEventListener('click', () => { musicCat = b.dataset.mcat; renderMusicPicker(); }));
  $$('#sheetBody [data-prev]').forEach((b) => b.addEventListener('click', () => {
    const s = songsCache.find((x) => x.id === b.dataset.prev);
    if (previewingId === s.id) { stopPreview(); b.textContent = '▶ Hear'; return; }
    stopPreview();
    previewAudio.src = s.src; previewAudio.play().catch(() => toast('Could not play that preview.'));
    previewingId = s.id; b.textContent = '⏸ Stop';
  }));
  $$('#sheetBody [data-use]').forEach((b) => b.addEventListener('click', () => {
    const s = songsCache.find((x) => x.id === b.dataset.use);
    stopPreview(); closeSheet();
    if (!musicTarget) return;
    if (musicTarget.type === 'editor') { editorSong = s; renderEditorSong(); toast('Music added 🎵'); }
    else if (musicTarget.type === 'video') {
      clipSongOverrides[musicTarget.id] = s.id;
      localStorage.setItem('solkin_clip_songs', JSON.stringify(clipSongOverrides));
      const idx = videosCache.findIndex((x) => x.id === musicTarget.id);
      renderPagerSoft();
      if (idx >= 0) { currentSlide = idx; applySoundToSlide(idx); }
      toast('Song set: ' + s.title + ' 🎵');
    }
    musicTarget = null;
  }));
}

/* ================= people & friends ================= */
function personRowHTML(p, actionHTML) {
  const posts = p.postCount != null ? ` · ${p.postCount} post${p.postCount === 1 ? '' : 's'}` : '';
  const dot = typeof p.online === 'boolean' ? `<span class="online-dot ${friendOnline(p) ? 'on' : ''}" data-dot-for="${p.id}" title="${friendOnline(p) ? 'Online now' : 'Offline'}"></span>` : '';
  // An adult receiving a request from a Protected account gets a plain note.
  const note = (p.relationship === 'pending_in' && p.crossBand && p.isProtected) ? '<div class="friend-note">Protected account (under 18)</div>' : '';
  return `<div class="card person">${avatarHTML(p.displayName, p.username, 'md')}
    <div class="grow"><div class="nm">${dot}${esc(p.displayName)}${p.isProtected ? '<span class="badge">🛡️ Protected</span>' : ''}</div><div class="sub">@${esc(p.username)}${posts}</div>${note}</div>
    ${actionHTML || ''}</div>`;
}
function friendBtnHTML(p) {
  if (!me || p.id === me.id || p.relationship === 'self') return '<span class="friend-state">You</span>';
  if (p.relationship === 'friends') return '<span class="friend-state ok">Friends ✓</span>';
  if (p.relationship === 'pending_out') return '<span class="friend-state">Requested</span>';
  if (p.relationship === 'pending_in') return `<span class="friend-btns"><button class="btn sm" data-friend="accept" data-req="${p.friendRequestId}"${p.attestBy === 'me' ? ' data-attest="1"' : ''} type="button">Accept</button><button class="btn ghost sm" data-friend="decline" data-req="${p.friendRequestId}" type="button">Decline</button></span>`;
  return `<button class="btn red sm" data-friend="add" data-id="${p.id}" data-protected="${p.isProtected ? '1' : '0'}" type="button">Add Friend</button>`;
}
async function loadPeople() {
  try {
    const data = await api('/api/people');
    $('#peopleList').innerHTML = data.people.map((p) => personRowHTML(p, friendBtnHTML(p))).join('') || '<div class="card empty">No people yet.</div>';
  } catch (e) { toast(e.message); }
}
function acceptDeclineBtns(p) {
  return `<span class="friend-btns"><button class="btn sm" data-friend="accept" data-req="${p.requestId}"${p.attestBy === 'me' ? ' data-attest="1"' : ''} type="button">Accept</button><button class="btn ghost sm" data-friend="decline" data-req="${p.requestId}" type="button">Decline</button></span>`;
}
async function loadFriends() {
  try {
    const data = await api('/api/friends');
    // Requests from grown-ups (I'm Protected, they're not) get their own
    // clearly separated section with a warning — see index.html.
    const grownups = data.incoming.filter((p) => p.crossBand && !p.isProtected);
    const regular = data.incoming.filter((p) => !(p.crossBand && !p.isProtected));
    $('#friendRequests').innerHTML = regular.length
      ? regular.map((p) => personRowHTML({ ...p, relationship: 'pending_in' }, acceptDeclineBtns(p))).join('')
      : '<div class="card empty">No new requests right now.</div>';
    $('#grownupRequests').classList.toggle('hidden', grownups.length === 0);
    $('#friendRequestsGrownups').innerHTML = grownups.map((p) => personRowHTML(p, acceptDeclineBtns(p))).join('');
    $('#friendList').innerHTML = data.friends.length
      ? data.friends.map((p) => personRowHTML(p, `<span class="friend-btns"><button class="btn sm" data-message="${p.id}" data-msgname="${esc(p.displayName)}" data-msguser="${esc(p.username)}" type="button">💬 Message</button>${p.phone ? `<a class="btn sm call-link" href="tel:${esc(p.phone)}">📞 Call</a>` : ''}<button class="btn sm" data-call="${p.id}" data-callname="${esc(p.displayName)}" type="button">📹 Video call</button><button class="btn ghost sm" data-friend="remove" data-id="${p.id}" type="button">Unfriend</button></span>`)).join('')
      : '<div class="card empty">No friends yet — add some from the People page! 🙂</div>';
    $('#friendOutgoing').innerHTML = data.outgoing.length
      ? data.outgoing.map((p) => personRowHTML(p, '<span class="friend-state">Requested</span>')).join('')
      : '<div class="card empty">None waiting.</div>';
  } catch (e) { toast(e.message); }
}
/* "I know this person in real life" confirm dialog (the Protected user's
 * key for cross-band friend requests). Resolves true only if the checkbox
 * is ticked and the confirm button is tapped. */
let kcResolve = null;
function confirmKnows(text, yesLabel) {
  return new Promise((resolve) => {
    kcResolve = resolve;
    $('#kcText').textContent = text;
    $('#kcYes').textContent = yesLabel;
    $('#kcCheck').checked = false;
    $('#kcYes').disabled = true;
    $('#knowConfirm').classList.remove('hidden');
  });
}
function closeKnowConfirm(v) {
  $('#knowConfirm').classList.add('hidden');
  if (kcResolve) { const r = kcResolve; kcResolve = null; r(v); }
}
$('#kcCheck').addEventListener('change', () => { $('#kcYes').disabled = !$('#kcCheck').checked; });
$('#kcYes').addEventListener('click', () => closeKnowConfirm(true));
$('#kcNo').addEventListener('click', () => closeKnowConfirm(false));

/* friend actions (event delegation) */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-friend]');
  if (!btn) return;
  const act = btn.dataset.friend;
  btn.disabled = true;
  try {
    if (act === 'add') {
      // I'm Protected and they're a grown-up: I hold the key — confirm
      // "I know this person in real life" before the request goes out.
      if (me && me.isProtected && btn.dataset.protected === '0') {
        const okd = await confirmKnows('You\'re sending a friend request to a grown-up. That\'s only for people you know in real life — like family or a family friend.', 'Send request');
        if (!okd) { btn.disabled = false; return; }
        await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ userId: +btn.dataset.id, knowsPerson: true }) });
      } else {
        await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ userId: +btn.dataset.id }) });
      }
      toast('Friend request sent! 📨');
    }
    else if (act === 'accept') {
      // A grown-up asked me (Protected): accepting needs the same confirm.
      if (btn.dataset.attest === '1') {
        const okd = await confirmKnows('This request is from a grown-up. Only accept people you know in real life. If you don\'t know them, tap Cancel and then Decline.', 'Accept');
        if (!okd) { btn.disabled = false; return; }
        await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ requestId: +btn.dataset.req, knowsPerson: true }) });
      } else {
        await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ requestId: +btn.dataset.req }) });
      }
      toast('You are friends now! 🎉');
    }
    else if (act === 'decline') { await api('/api/friends/decline', { method: 'POST', body: JSON.stringify({ requestId: +btn.dataset.req }) }); toast('Request declined.'); }
    else if (act === 'remove') { await api('/api/friends/remove', { method: 'POST', body: JSON.stringify({ userId: +btn.dataset.id }) }); toast('Unfriended.'); }
    if (!$('#view-people').classList.contains('hidden')) loadPeople();
    if (!$('#view-friends').classList.contains('hidden')) loadFriends();
  } catch (ex) { toast(ex.message); btn.disabled = false; }
});

/* ================= messages (private 1:1 chat between friends) =================
 * The Chat tab lists one row per friend: last message preview (a photo
 * with no caption previews as "📷 Photo"; a snap previews as "📸 Flash"
 * or "📸 Flash opened") + unread count. Tapping a row (or the Message
 * button in the Friends list) opens the thread full-screen; opening it
 * marks their messages to me as read (the server does that in
 * GET /api/messages/:userId). A thread carries text, photo messages —
 * the 📷 button beside the input sends a picture from the gallery or
 * the in-app camera — and DISAPPEARING SNAPS: a snap arrives as a
 * tap-to-view chip (never a picture; the server never sends its URL),
 * and the one tap spends it — the server streams the bytes once and
 * deletes its copy in the same request. New messages arrive live over
 * the same WebSocket as call signaling: {type:'dm'} appends to an open
 * thread, {type:'dm-unread'} refreshes the badge on the Chat tab, and
 * {type:'snap-opened'} flips the sender's chip to "opened". */
let chatPeer = null; // the friend whose thread is open: {id, displayName, username}

function setUnreadBadge(n) {
  const b = $('#chatBadge');
  b.textContent = n > 99 ? '99+' : String(n);
  b.classList.toggle('hidden', !n);
}
async function refreshUnreadBadge() {
  try { const data = await api('/api/conversations'); setUnreadBadge(data.totalUnread); } catch (e) { /* best-effort */ }
}
function convoRowHTML(c) {
  const u = c.user;
  const last = c.lastMessage;
  const preview = last ? (last.mine ? 'You: ' : '') + (last.isSnap ? (last.snapOpened ? '📸 Flash opened' : '📸 Flash') : (last.text || (last.mediaUrl ? '📷 Photo' : ''))) : 'Say hi! 👋';
  const when = last ? timeAgo(last.createdAt) : '';
  const pill = c.unread ? `<span class="unread-pill">${c.unread > 99 ? '99+' : c.unread}</span>` : '';
  return `<div class="card person convo" data-convo="${u.id}" data-msgname="${esc(u.displayName)}" data-msguser="${esc(u.username)}">${avatarHTML(u.displayName, u.username, 'md')}
    <div class="grow"><div class="nm">${esc(u.displayName)}${u.isProtected ? '<span class="badge">🛡️ Protected</span>' : ''}</div><div class="sub preview">${esc(preview)}</div></div>
    <span class="convo-side"><span class="sub">${esc(when)}</span>${pill}</span></div>`;
}
async function loadConversations() {
  try {
    const data = await api('/api/conversations');
    setUnreadBadge(data.totalUnread);
    $('#chatList').innerHTML = data.conversations.length
      ? data.conversations.map(convoRowHTML).join('')
      : '<div class="card empty">No friends yet — add some from the People page, then you can message them here! 💬</div>';
  } catch (e) { toast(e.message); }
}
function bubbleHTML(m) {
  const text = m.text ? `<div class="bubble">${esc(m.text)}</div>` : '';
  if (m.isSnap) {
    // A snap bubble NEVER carries the picture itself (the server never
    // sends its URL). Mine shows sent/opened; theirs is a tap-to-view
    // chip until the one open spends it, then a tombstone.
    let chip;
    if (m.mine) chip = `<div class="snap-chip ${m.snapOpened ? 'opened' : ''}">📸 Flash — ${m.snapOpened ? 'opened' : 'sent'}</div>`;
    else if (m.snapOpened) chip = '<div class="snap-chip opened">📸 Flash — opened</div>';
    else chip = `<button class="snap-chip tap" type="button" data-snap-open="${m.id}">📸 Flash — tap to view</button>`;
    return `<div class="bubble-row ${m.mine ? 'mine' : 'theirs'}" data-msg-row="${m.id}">${chip}${text}<div class="btime">${timeAgo(m.createdAt)}</div></div>`;
  }
  const photo = m.mediaUrl ? `<a class="bubble-photo" href="${esc(m.mediaUrl)}" target="_blank" rel="noopener"><img src="${esc(m.mediaUrl)}" alt="Photo" loading="lazy"></a>` : '';
  return `<div class="bubble-row ${m.mine ? 'mine' : 'theirs'}" data-msg-row="${m.id}">${photo}${text}<div class="btime">${timeAgo(m.createdAt)}</div></div>`;
}
function scrollThread() { const b = $('#threadBody'); b.scrollTop = b.scrollHeight; }
async function openThread(user) {
  chatPeer = user;
  $('#threadAvatar').innerHTML = avatarHTML(user.displayName, user.username, 'sm');
  $('#threadName').textContent = user.displayName;
  const callLink = $('#threadCall'); // 📞 Call — shown only when the server shared a number
  callLink.classList.add('hidden');
  callLink.removeAttribute('href');
  $('#threadBody').innerHTML = '<p class="empty">Loading…</p>';
  $('#threadView').classList.remove('hidden');
  try {
    const data = await api('/api/messages/' + user.id);
    if (!chatPeer || chatPeer.id !== user.id) return; // closed or switched while loading
    if (data.user && data.user.phone) { callLink.href = 'tel:' + data.user.phone; callLink.classList.remove('hidden'); }
    $('#threadBody').innerHTML = data.messages.length
      ? data.messages.map(bubbleHTML).join('')
      : '<p class="empty">No messages yet — say hi! 👋</p>';
    scrollThread();
    refreshUnreadBadge(); // opening the thread marked their messages read
    if (currentView === 'chat') loadConversations();
  } catch (e) {
    closeThread();
    toast(e.message);
  }
}
function closeThread() {
  chatPeer = null;
  $('#threadView').classList.add('hidden');
  if (currentView === 'chat') loadConversations();
}
$('#threadBack').addEventListener('click', closeThread);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && chatPeer) closeThread();
});
$('#threadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!chatPeer) return;
  const input = $('#threadText');
  const text = input.value.trim();
  if (!text) return;
  try {
    const r = await api('/api/messages/' + chatPeer.id, { method: 'POST', body: JSON.stringify({ text }) });
    const empty = $('#threadBody .empty'); if (empty) empty.remove();
    $('#threadBody').insertAdjacentHTML('beforeend', bubbleHTML(r.message));
    input.value = '';
    scrollThread();
  } catch (ex) { toast(ex.message); }
});
/* ---- photo messages + snaps ----
 * The 📷 button beside the thread input opens a small sheet with three
 * choices, in the same style as the other sheets: Photo (pick from the
 * gallery) or Camera (the in-app camera, opened in its 'thread' mode so
 * the capture comes back here instead of the post editor) — both end in
 * sendThreadPhoto — or Snap (the camera in its 'snap' mode), which ends
 * in sendThreadSnap: a disappearing picture the friend can open exactly
 * once. All post multipart — the same 'media' field posts use — with
 * anything typed in the input as the caption. */
function openThreadAttach() {
  if (!chatPeer) return;
  openSheet('Send a photo 📷');
  $('#sheetBody').innerHTML = '<div class="attach-choices">' +
    '<button class="btn block" id="attPhoto" type="button">📷 Photo — pick from your pictures</button>' +
    '<button class="btn block" id="attCamera" type="button">📸 Camera — take a new picture</button>' +
    '<button class="btn block" id="attSnap" type="button">📸 Flash — disappears after they see it</button></div>';
  $('#attPhoto').addEventListener('click', () => { closeSheet(); $('#threadPhotoFile').click(); });
  $('#attCamera').addEventListener('click', () => { closeSheet(); openCamera('thread'); });
  $('#attSnap').addEventListener('click', () => { closeSheet(); openCamera('snap'); });
}
async function sendThreadSnap(file) {
  if (!chatPeer || !file) return;
  const peerId = chatPeer.id;
  const fd = new FormData();
  const caption = $('#threadText').value.trim();
  if (caption) fd.append('text', caption);
  fd.append('snap', '1');
  fd.append('media', file);
  try {
    const res = await fetch('/api/messages/' + peerId, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'That Flash could not be sent.');
    if (!chatPeer || chatPeer.id !== peerId) return; // thread closed or switched while sending
    const empty = $('#threadBody .empty'); if (empty) empty.remove();
    $('#threadBody').insertAdjacentHTML('beforeend', bubbleHTML(data.message));
    $('#threadText').value = '';
    scrollThread();
    toast('Flash sent 📸 — it disappears when they open it');
  } catch (ex) { toast(ex.message); }
}
/* ---- opening a snap (recipient, exactly once) ----
 * Tapping a snap chip calls the open endpoint, which streams the
 * picture bytes AND deletes the stored copy in the same request. The
 * bytes live only in an object URL for the viewer, revoked the moment
 * it closes — nothing is kept, cached or re-openable. */
let snapObjectUrl = null;
function showSnapViewer(url) {
  snapObjectUrl = url;
  $('#snapImg').src = url;
  $('#snapView').classList.remove('hidden');
}
function closeSnapViewer() {
  $('#snapView').classList.add('hidden');
  $('#snapImg').removeAttribute('src');
  if (snapObjectUrl) { URL.revokeObjectURL(snapObjectUrl); snapObjectUrl = null; }
}
$('#snapClose').addEventListener('click', closeSnapViewer);
$('#snapStage').addEventListener('click', closeSnapViewer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#snapView').classList.contains('hidden')) closeSnapViewer();
});
async function openSnap(id, chip) {
  if (chip) chip.disabled = true;
  try {
    const res = await fetch('/api/messages/' + id + '/open', { method: 'POST' });
    if (!res.ok) {
      let msg = 'That Flash is gone.';
      try { const d = await res.json(); if (d.error) msg = d.error; } catch (e) { /* keep default */ }
      toast(msg);
      // It's spent either way — settle the chip into its tombstone.
      if (chip) { const tomb = document.createElement('div'); tomb.className = 'snap-chip opened'; tomb.textContent = '📸 Flash — opened'; chip.replaceWith(tomb); }
      return;
    }
    const blob = await res.blob();
    if (chip) { const tomb = document.createElement('div'); tomb.className = 'snap-chip opened'; tomb.textContent = '📸 Flash — opened'; chip.replaceWith(tomb); }
    showSnapViewer(URL.createObjectURL(blob));
    if (currentView === 'chat') loadConversations();
  } catch (ex) {
    toast('That Flash could not be opened.');
    if (chip) chip.disabled = false;
  }
}
document.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-snap-open]');
  if (chip) openSnap(+chip.dataset.snapOpen, chip);
});
/* The sender learns live that their snap was opened: flip the chip in
 * the open thread (reload shows the same tombstone from the server). */
function onSnapOpened(m) {
  if (chatPeer && chatPeer.id === m.userId) {
    const chip = document.querySelector('[data-msg-row="' + m.messageId + '"] .snap-chip');
    if (chip) { chip.textContent = '📸 Flash — opened'; chip.classList.add('opened'); }
  }
  if (currentView === 'chat') loadConversations();
}
async function sendThreadPhoto(file) {
  if (!chatPeer || !file) return;
  const peerId = chatPeer.id;
  const fd = new FormData();
  const caption = $('#threadText').value.trim();
  if (caption) fd.append('text', caption);
  fd.append('media', file);
  try {
    const res = await fetch('/api/messages/' + peerId, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'That photo could not be sent.');
    if (!chatPeer || chatPeer.id !== peerId) return; // thread closed or switched while sending
    const empty = $('#threadBody .empty'); if (empty) empty.remove();
    $('#threadBody').insertAdjacentHTML('beforeend', bubbleHTML(data.message));
    $('#threadText').value = '';
    scrollThread();
  } catch (ex) { toast(ex.message); }
}
$('#threadAttach').addEventListener('click', openThreadAttach);
$('#threadPhotoFile').addEventListener('change', (e) => { if (e.target.files[0]) sendThreadPhoto(e.target.files[0]); e.target.value = ''; });
/* conversation rows + Friends-list Message buttons open the thread */
document.addEventListener('click', (e) => {
  const row = e.target.closest('[data-convo]');
  if (row) { openThread({ id: +row.dataset.convo, displayName: row.dataset.msgname, username: row.dataset.msguser }); return; }
  const btn = e.target.closest('[data-message]');
  if (btn) openThread({ id: +btn.dataset.message, displayName: btn.dataset.msgname, username: btn.dataset.msguser });
});
function onIncomingDm(m) {
  const msg = m.message;
  if (!msg) return;
  if (chatPeer && chatPeer.id === msg.senderId && !$('#threadView').classList.contains('hidden')) {
    // I'm looking at this very thread: show it, then re-fetch so the
    // server marks it read and the badge stays honest.
    const empty = $('#threadBody .empty'); if (empty) empty.remove();
    $('#threadBody').insertAdjacentHTML('beforeend', bubbleHTML({ ...msg, mine: false }));
    scrollThread();
    api('/api/messages/' + msg.senderId).then(() => refreshUnreadBadge()).catch(() => {});
  } else if (msg.from) {
    const shown = msg.isSnap ? '📸 Flash' : (msg.text || (msg.mediaUrl ? '📷 Photo' : ''));
    toast('💬 ' + msg.from.displayName + ': ' + (shown.length > 60 ? shown.slice(0, 60) + '…' : shown));
  }
  if (currentView === 'chat') loadConversations();
}

/* ================= video calls (WebRTC + WebSocket signaling) ================= */
// The server relays only the setup messages; picture and sound travel
// directly between the two phones/computers. Calls work between friends
// who are both online — the server checks the rules, we just show them.
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let wsConn = null, wsRetryTimer = null;
let onlineFriends = new Set();
let presenceReady = false;
let pc = null;               // RTCPeerConnection for the current call
let localStream = null;      // camera + mic stream
let activeCall = null;       // { callId, peerId, peerName, role: 'caller' | 'callee' }
let pendingCall = null;      // incoming call waiting on Accept/Decline: { callId, from }
let pendingOffer = null;     // SDP offer that arrived before Accept was tapped
let pendingIce = [];         // ICE candidates that arrived before the remote description was set

function friendOnline(p) { return presenceReady ? onlineFriends.has(p.id) : !!p.online; }
function patchOnlineDots() {
  $$('[data-dot-for]').forEach((el) => {
    const on = onlineFriends.has(+el.dataset.dotFor);
    el.classList.toggle('on', on);
    el.title = on ? 'Online now' : 'Offline';
  });
}
function connectWS() {
  if (!me || wsConn) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try { wsConn = new WebSocket(proto + '//' + location.host + '/ws'); } catch (e) { return; }
  wsConn.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onWsMessage(m); };
  wsConn.onclose = () => { wsConn = null; clearTimeout(wsRetryTimer); if (me) wsRetryTimer = setTimeout(connectWS, 3000); };
  wsConn.onerror = () => { try { wsConn.close(); } catch (e) { /* ignore */ } };
}
function wsSendMsg(obj) { if (wsConn && wsConn.readyState === WebSocket.OPEN) wsConn.send(JSON.stringify(obj)); }

function onWsMessage(m) {
  if (m.type === 'presence') { onlineFriends = new Set(m.online || []); presenceReady = true; patchOnlineDots(); }
  else if (m.type === 'dm') onIncomingDm(m);
  else if (m.type === 'dm-unread') setUnreadBadge(m.count || 0);
  else if (m.type === 'snap-opened') onSnapOpened(m);
  else if (m.type === 'friend-online' && m.user) { onlineFriends.add(m.user.id); patchOnlineDots(); }
  else if (m.type === 'friend-offline' && m.user) { onlineFriends.delete(m.user.id); patchOnlineDots(); }
  else if (m.type === 'incoming-call') showIncomingCall(m);
  else if (m.type === 'ringing') onCallRinging(m);
  else if (m.type === 'offer') handleOffer(m);
  else if (m.type === 'answer') handleAnswer(m);
  else if (m.type === 'ice') handleIce(m);
  else if (m.type === 'declined') { toast((activeCall ? activeCall.peerName : 'Your friend') + ' declined the call.'); cleanupCall(false); }
  else if (m.type === 'ended') { toast(m.reason === 'disconnected' ? 'The call dropped — they disconnected.' : 'Call ended.'); cleanupCall(false); }
  else if (m.type === 'call-error') {
    toast(m.error || 'The call could not go through.');
    if (activeCall && !activeCall.callId) cleanupCall(false); // refused before it ever rang — tear down the "Calling…" screen
    if (pendingCall && m.callId === pendingCall.callId) { pendingCall = null; pendingOffer = null; $('#callPopup').classList.add('hidden'); }
  }
}

async function getLocalStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('This browser cannot use a camera for calls. Try Chrome or Safari on your phone.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw new Error('Camera and microphone are blocked. Allow them for this site in your browser settings, then try the call again.');
    if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError' || e.name === 'NotReadableError' || e.name === 'NotFoundError')) throw new Error('No working camera or microphone was found on this device.');
    throw new Error('Could not start your camera or microphone.');
  }
}
function newPeerConnection() {
  pc = new RTCPeerConnection(RTC_CONFIG);
  pc.onicecandidate = (e) => { if (e.candidate && activeCall && activeCall.callId) wsSendMsg({ type: 'ice', callId: activeCall.callId, candidate: e.candidate }); };
  pc.ontrack = (e) => { if (e.streams && e.streams[0]) $('#remoteVideo').srcObject = e.streams[0]; };
  pc.onconnectionstatechange = () => { if (pc && pc.connectionState === 'connected') setCallStatus('Connected 🎉'); };
  if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  return pc;
}
function setCallStatus(txt) { $('#callStatus').textContent = txt; }
function showCallScreen(peerName, status) {
  $('#callPeerName').textContent = peerName;
  setCallStatus(status);
  $('#callView').classList.remove('hidden');
}
function startVideoCall(userId, peerName) {
  if (activeCall || pendingCall) { toast('Finish this call first 🙂'); return; }
  getLocalStream().then((stream) => {
    localStream = stream;
    activeCall = { callId: null, peerId: userId, peerName, role: 'caller' };
    showCallScreen(peerName, 'Calling…');
    $('#localVideo').srcObject = stream;
    wsSendMsg({ type: 'call', to: userId });
  }).catch((e) => toast(e.message));
}
async function onCallRinging(m) {
  if (!activeCall || activeCall.role !== 'caller') return;
  activeCall.callId = m.callId;
  setCallStatus('Ringing…');
  newPeerConnection();
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsSendMsg({ type: 'offer', callId: m.callId, sdp: pc.localDescription });
  } catch (e) { toast('Could not set up the call.'); cleanupCall(true); }
}
function showIncomingCall(m) {
  if (activeCall || pendingCall) return; // the server keeps us to one call; ignore anything extra
  pendingCall = { callId: m.callId, from: m.from };
  pendingOffer = null;
  $('#callFromAvatar').innerHTML = avatarHTML(m.from.displayName, m.from.username, 'lg');
  $('#callFromName').textContent = m.from.displayName;
  $('#callPopup').classList.remove('hidden');
}
async function acceptCall() {
  if (!pendingCall) return;
  const call = pendingCall;
  $('#callPopup').classList.add('hidden');
  let stream;
  try { stream = await getLocalStream(); }
  catch (e) { toast(e.message); wsSendMsg({ type: 'decline', callId: call.callId }); pendingCall = null; pendingOffer = null; return; }
  localStream = stream;
  activeCall = { callId: call.callId, peerId: call.from.id, peerName: call.from.displayName, role: 'callee' };
  pendingCall = null;
  showCallScreen(call.from.displayName, 'Connecting…');
  $('#localVideo').srcObject = stream;
  newPeerConnection();
  if (pendingOffer) { const sdp = pendingOffer; pendingOffer = null; handleOffer({ callId: call.callId, sdp }); }
}
function declineCall() {
  if (!pendingCall) return;
  wsSendMsg({ type: 'decline', callId: pendingCall.callId });
  pendingCall = null; pendingOffer = null;
  $('#callPopup').classList.add('hidden');
}
async function handleOffer(m) {
  if (pendingCall && m.callId === pendingCall.callId) { pendingOffer = m.sdp; return; } // still deciding — hold it
  if (!activeCall || activeCall.callId !== m.callId || activeCall.role !== 'callee' || !pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
    flushPendingIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsSendMsg({ type: 'answer', callId: m.callId, sdp: pc.localDescription });
    setCallStatus('Connecting…');
  } catch (e) { toast('Could not answer the call.'); cleanupCall(true); }
}
async function handleAnswer(m) {
  if (!activeCall || activeCall.callId !== m.callId || !pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
    flushPendingIce();
    setCallStatus('Connecting…');
  } catch (e) { toast('The call could not connect.'); cleanupCall(true); }
}
async function handleIce(m) {
  if (!activeCall || activeCall.callId !== m.callId || !m.candidate) return;
  if (!pc || !pc.remoteDescription) { pendingIce.push(m.candidate); return; }
  try { await pc.addIceCandidate(new RTCIceCandidate(m.candidate)); } catch (e) { /* stale candidate — ignore */ }
}
function flushPendingIce() {
  const list = pendingIce; pendingIce = [];
  list.forEach((c) => { pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}); });
}
function cleanupCall(sendHangup) {
  if (sendHangup && activeCall && activeCall.callId) wsSendMsg({ type: 'hangup', callId: activeCall.callId });
  if (pc) { try { pc.close(); } catch (e) { /* ignore */ } pc = null; }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  $('#remoteVideo').srcObject = null;
  $('#localVideo').srcObject = null;
  activeCall = null; pendingOffer = null; pendingIce = [];
  $('#callView').classList.add('hidden');
  const muteBtn = $('#btnMute'), camBtn = $('#btnCam');
  muteBtn.classList.remove('off'); muteBtn.innerHTML = '🎤<span>Mute</span>';
  camBtn.classList.remove('off'); camBtn.innerHTML = '📷<span>Camera</span>';
}
$('#btnCallAccept').addEventListener('click', acceptCall);
$('#btnCallDecline').addEventListener('click', declineCall);
$('#btnHangup').addEventListener('click', () => cleanupCall(true));
$('#btnMute').addEventListener('click', () => {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0]; if (!track) return;
  track.enabled = !track.enabled;
  $('#btnMute').classList.toggle('off', !track.enabled);
  $('#btnMute').innerHTML = track.enabled ? '🎤<span>Mute</span>' : '🔇<span>Unmute</span>';
});
$('#btnCam').addEventListener('click', () => {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0]; if (!track) return;
  track.enabled = !track.enabled;
  $('#btnCam').classList.toggle('off', !track.enabled);
  $('#btnCam').innerHTML = track.enabled ? '📷<span>Camera</span>' : '🚫<span>Camera off</span>';
});
/* "Video call" buttons in the Friends list */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-call]');
  if (!btn) return;
  startVideoCall(+btn.dataset.call, btn.dataset.callname || 'Friend');
});

/* ================= friend map =================
 * Opt-in location sharing between friends. The Profile toggle (and
 * its shortcut twin on the Map page) flips users.share_location via
 * PATCH /api/me; while sharing is on, the app posts a fix to
 * POST /api/location on load, when the Map tab opens, and every ~60s.
 * The Map tab renders GET /api/map — only friends the server cleared
 * through visibleLocation — as Leaflet pins on OpenStreetMap tiles.
 * Protected accounts never share and never appear (the server refuses
 * their fixes and never serves their location). Geolocation trouble
 * toasts once, never in a loop. If the Leaflet CDN failed to load, the
 * Map page shows a plain fallback instead of a blank box. */
let leafletMap = null;
let mapMarkers = [];
let locTimer = null;
let locWarned = false; // a failed fix warns once, not every minute
const HOME_SPOT = [42.8875, -77.2817]; // Canandaigua, NY — the default center

function mySharingOn() { return !!(me && me.shareLocation); }
function updatedLabel(iso) {
  if (!iso) return 'a while ago';
  const t = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('Z') ? '' : 'Z')).getTime();
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs === 1 ? '1 hr ago' : hrs + ' hrs ago';
  const days = Math.floor(hrs / 24);
  return days === 1 ? '1 day ago' : days + ' days ago';
}
function renderSharingUI() {
  if (!me) return;
  const on = mySharingOn();
  const prot = !!me.isProtected;
  const pBtn = $('#btnShareLoc');
  if (pBtn) { pBtn.classList.toggle('hidden', prot); pBtn.textContent = on ? 'Turn off' : 'Turn on'; pBtn.classList.toggle('ghost', on); }
  const pState = $('#locState');
  if (pState) pState.textContent = prot ? '🛡️ Protected accounts never share location.' : (on ? 'On — friends can see where you are on the map.' : "Off — friends can't see where you are.");
  const pHint = $('#locHint');
  if (pHint) pHint.textContent = prot
    ? 'Your location is never shown to anyone on the map — that is a safety rule, not a setting.'
    : (on ? 'While this is on, the app updates your spot whenever it is open. Turn it off any time — your saved spot is wiped right away.'
          : 'Turn it on and your friends can find you on the Friend Map. Only friends can see it, and only while you keep it on.');
  const mBtn = $('#mapToggleShare');
  if (mBtn) { mBtn.classList.toggle('hidden', prot); mBtn.textContent = on ? 'Turn off' : 'Turn on'; mBtn.classList.toggle('ghost', on); }
  const mState = $('#mapMyState');
  if (mState) mState.textContent = prot ? '🛡️ Your location is never shared' : (on ? 'You are sharing your location' : 'Location sharing is off');
  const mHint = $('#mapMyHint');
  if (mHint) mHint.textContent = prot ? "Protected accounts can't share location here." : (on ? 'Friends can see you on this map.' : "Turn it on to appear on your friends' maps.");
}
async function setSharing(on) {
  try {
    const r = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ shareLocation: on }) });
    me = r.user;
    renderSharingUI();
    if (on) { updateMyLocation(); toast('Location sharing on 📍 — friends can see you on the map'); }
    else toast('Location sharing off — your spot was wiped from the map');
    if (currentView === 'map') loadMap();
  } catch (e) { toast(e.message); }
}
function warnLocOnce() {
  if (locWarned) return;
  locWarned = true;
  toast("Couldn't get your location — if you want to share it, check that location is allowed for this site. 📍");
}
function updateMyLocation() {
  if (!mySharingOn()) return;
  if (!navigator.geolocation) { warnLocOnce(); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => { api('/api/location', { method: 'POST', body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }) }).catch(() => {}); },
    () => warnLocOnce(),
    { maximumAge: 30000, timeout: 10000 }
  );
}
function startLocationUpdates() {
  // The login response carries the public profile; /api/me is the one
  // that knows my sharing switch — refresh it, then send a first fix.
  api('/api/me').then((d) => { me = d.user; renderSharingUI(); updateMyLocation(); }).catch(() => {});
  if (!locTimer) locTimer = setInterval(updateMyLocation, 60000);
}
async function loadMap() {
  try { const d = await api('/api/me'); me = d.user; } catch (e) { /* keep what we have */ }
  renderSharingUI();
  updateMyLocation(); // opening the Map tab is one of the update moments
  let pins = [];
  try { pins = (await api('/api/map')).friends || []; } catch (e) { toast(e.message); }
  $('#mapEmpty').classList.toggle('hidden', pins.length > 0);
  if (typeof L === 'undefined') { // Leaflet CDN failed — a plain note, never a blank page
    $('#mapEl').classList.add('hidden');
    $('#mapNoLib').classList.remove('hidden');
    return;
  }
  $('#mapNoLib').classList.add('hidden');
  $('#mapEl').classList.remove('hidden');
  if (!leafletMap) {
    leafletMap = L.map('mapEl').setView(HOME_SPOT, 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(leafletMap);
  }
  mapMarkers.forEach((m) => m.remove());
  mapMarkers = pins.map((f) => L.marker([f.lat, f.lng]).addTo(leafletMap)
    .bindPopup('<b>' + esc(f.user.displayName) + '</b><br>Updated ' + updatedLabel(f.updatedAt)));
  if (pins.length) {
    leafletMap.fitBounds(L.latLngBounds(pins.map((f) => [f.lat, f.lng])), { padding: [30, 30], maxZoom: 13 });
  } else if (navigator.geolocation) {
    // Nobody to show: center on my own spot if the browser offers it,
    // otherwise stay on Canandaigua.
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (leafletMap && currentView === 'map') leafletMap.setView([pos.coords.latitude, pos.coords.longitude], 12); },
      () => { if (leafletMap) leafletMap.setView(HOME_SPOT, 12); },
      { maximumAge: 60000, timeout: 8000 }
    );
  }
  // The view was hidden a moment ago — Leaflet must re-measure its box.
  setTimeout(() => { if (leafletMap) leafletMap.invalidateSize(); }, 60);
}
$('#btnShareLoc').addEventListener('click', () => setSharing(!mySharingOn()));
$('#mapToggleShare').addEventListener('click', () => setSharing(!mySharingOn()));

/* ================= profile ================= */
async function loadProfile() {
  try {
    const data = await api('/api/me');
    me = data.user;
    $('#profAvatar').innerHTML = avatarHTML(me.displayName, me.username, 'lg');
    $('#profName').innerHTML = esc(me.displayName) + (me.isProtected ? '<span class="badge">🛡️ Protected account</span>' : '');
    $('#profSub').textContent = '@' + me.username;
    $('#stPosts').textContent = data.stats.posts;
    $('#stLikes').textContent = data.stats.likesReceived;
    $('#stComments').textContent = data.stats.comments;
    if (!$('#editName').value) $('#editName').placeholder = me.displayName;
    $('#editPhone').value = me.phone || '';
    $('#phoneHint').textContent = me.isProtected
      ? '🛡️ Your number stays private — it is never shown to anyone, not even friends.'
      : 'Add your number and your friends get a 📞 Call button that rings your real phone. Only friends can see it — clear the box and Save to turn it off.';
    renderSharingUI();
    const mine = await api('/api/my/posts');
    const box = $('#myPosts');
    box.innerHTML = mine.posts.length ? mine.posts.map(postCardHTML).join('') : '<div class="card empty">You have not posted yet — say hi! 👋</div>';
    wirePostMedia(box);
  } catch (e) { toast(e.message); }
}
$('#btnSaveName').addEventListener('click', async () => {
  const name = $('#editName').value.trim();
  if (!name) { toast('Type a new name first 🙂'); return; }
  try {
    const r = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ displayName: name }) });
    me = r.user; $('#editName').value = '';
    $('#meName').textContent = me.displayName.split(' ')[0];
    $('#meAvatar').innerHTML = avatarHTML(me.displayName, me.username, 'sm');
    $('#composerAvatar').innerHTML = avatarHTML(me.displayName, me.username, 'md');
    loadProfile(); loadFeed();
    toast('Name saved ✅');
  } catch (e) { toast(e.message); }
});
$('#btnSavePhone').addEventListener('click', async () => {
  try {
    const r = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ phone: $('#editPhone').value.trim() }) });
    me = r.user;
    $('#editPhone').value = me.phone || '';
    toast(me.phone ? 'Phone number saved 📞 — friends can call you now' : 'Phone number removed — nobody can call you from the app');
  } catch (e) { toast(e.message); }
});
$('#btnLogout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {});
  location.reload();
});

/* ================= init ================= */
(async function init() {
  renderSoundPills();
  try {
    const data = await api('/api/me');
    me = data.user;
    enterApp();
  } catch (e) {
    $('#authView').classList.remove('hidden');
    setAuthMode('login');
  }
})();
